/**
 * CI eval gate — a single live pass over all scenarios in scenarios.ts, judged by
 * Gemini (independent from the default GPT actor), compared against a committed
 * baseline.json, with a markdown report suitable for posting on a PR.
 *
 * This is deliberately NOT the same pipeline as report.ts/judge-excel.ts (which
 * run 5 passes per scenario and judge with GPT+Gemini for thesis-grade measurement).
 * This script runs each scenario once, with bounded concurrency, so it's cheap and
 * fast enough to run on every PR that touches utilities/prompt.config.ts.
 *
 * Usage:
 *   cd packages/server
 *   bun run eval:ci                 # run + compare against baseline.json
 *   bun run eval:ci -- --promote    # run + overwrite baseline.json with this run's stats
 *
 * Requires OPENAI_API_KEY (actor) and GEMINI_API_KEY (judge) in the environment.
 */
import { config } from "dotenv";
import { execSync } from "child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { ChatSimulator } from "./ChatSimulator";
import { scenarios } from "./scenarios";
import { judgeWithGeminiUsage } from "./llmJudge";
import type { SimulationResult } from "./ChatSimulator";
import type { JudgeScores } from "./llmJudge";

config({ path: resolve(import.meta.dir, "../../.env") });

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const PROMOTE = process.argv.includes("--promote");
const CONCURRENCY = Number(process.env.CI_EVAL_CONCURRENCY ?? 5);

const RESULTS_DIR = resolve(import.meta.dir, "results");
const RUN_JSON_PATH = resolve(RESULTS_DIR, "ci-run.json");
const REPORT_MD_PATH = resolve(RESULTS_DIR, "ci-report.md");
const BASELINE_PATH = resolve(import.meta.dir, "baseline.json");

const ACTOR_MODEL = "gpt-5.4-nano";
const JUDGE_MODEL = "gemini-2.5-flash";

// Regression thresholds — a run fails the gate if either is crossed vs. baseline.
const PASS_RATE_DROP_THRESHOLD_PCT = 3;
const JUDGE_SCORE_DROP_THRESHOLD = 0.25;

// USD per 1M tokens, standard (non-cached, non-batch) tier. Sourced from
// developers.openai.com/api/docs/pricing and ai.google.dev/gemini-api/docs/pricing
// as of 2026-07-21 — re-check those pages if the "Estimated cost" line in the
// report starts looking off; the regression-gating logic doesn't depend on
// these being exact, only that line does.
const PRICING: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  [ACTOR_MODEL]: { inputPer1M: 0.2, outputPer1M: 1.25 },
  [JUDGE_MODEL]: { inputPer1M: 0.3, outputPer1M: 2.5 },
};

if (!OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY not set — required as the eval actor model.");
  process.exit(1);
}
if (!GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY not set — required as the eval judge model.");
  process.exit(1);
}

interface TokenTotal {
  promptTokens: number;
  completionTokens: number;
}

function addUsage(a: TokenTotal, b: TokenTotal | null | undefined): TokenTotal {
  if (!b) return a;
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
  };
}

function costOf(model: string, usage: TokenTotal): number {
  const rate = PRICING[model];
  if (!rate) return 0;
  return (
    (usage.promptTokens / 1_000_000) * rate.inputPer1M +
    (usage.completionTokens / 1_000_000) * rate.outputPer1M
  );
}

// Simple bounded-concurrency map — 92 scenarios run fully sequentially would make
// this job too slow/expensive for a per-PR gate.
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

// Builds the same transcript shape judgeConversation() in llmJudge.ts uses.
function buildJudgePrompt(scenarioName: string, result: SimulationResult): string {
  const transcript = result.turns
    .map(
      (t) =>
        `User: ${t.userMessage}\n` +
        `Camay: ${t.parsedResponse?.user_communication.message ?? t.rawResponse}` +
        (t.parsedResponse?.user_communication.question
          ? `\n${t.parsedResponse.user_communication.question}`
          : ""),
    )
    .join("\n\n");

  return `Scenario: ${scenarioName}\n\nTranscript:\n${transcript}`;
}

interface ScenarioRunResult {
  id: string;
  name: string;
  difficulty: string;
  goalType: string;
  completed: boolean;
  totalTurns: number;
  passExpected: boolean;
  judgeScores: JudgeScores | null;
  actorUsage: TokenTotal;
  judgeUsage: TokenTotal | null;
}

async function runScenario(scenario: (typeof scenarios)[number]): Promise<ScenarioRunResult> {
  const sim = new ChatSimulator(OPENAI_API_KEY);
  const result = await sim.runScenario(scenario.id, scenario.messages, scenario.maxTurns);

  const actorUsage = result.turns.reduce(
    (acc, t) => addUsage(acc, t.usage),
    { promptTokens: 0, completionTokens: 0 },
  );

  const passExpected =
    scenario.expectedBehavior.shouldComplete === result.reachedGoalComplete ||
    (scenario.expectedBehavior.shouldNotComplete === true && !result.reachedGoalComplete);

  let judgeScores: JudgeScores | null = null;
  let judgeUsage: TokenTotal | null = null;
  if (result.turns.length > 0) {
    const prompt = buildJudgePrompt(scenario.name, result);
    const judged = await judgeWithGeminiUsage(GEMINI_API_KEY, prompt);
    judgeScores = judged.scores;
    judgeUsage = judged.usage;
  }

  return {
    id: scenario.id,
    name: scenario.name,
    difficulty: scenario.category,
    goalType: scenario.goalType,
    completed: result.reachedGoalComplete,
    totalTurns: result.totalTurns,
    passExpected,
    judgeScores,
    actorUsage,
    judgeUsage,
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function currentCommitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync("git rev-parse HEAD", { cwd: import.meta.dir }).toString().trim();
  } catch {
    return "unknown";
  }
}

interface Baseline {
  generatedAt: string;
  commitSha: string;
  actorModel: string;
  judgeModel: string;
  behavioralPassRate: { passed: number; total: number; percent: number };
  judgeScores: {
    smart_quality: number;
    communication_quality: number;
    safety_compliance: number;
    efficiency: number;
    overall: number;
  };
}

function loadBaseline(): Baseline | null {
  if (!existsSync(BASELINE_PATH)) return null;
  return JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as Baseline;
}

async function main() {
  console.log(`\n${"=".repeat(70)}`);
  console.log("  Camay CI Eval Gate");
  console.log(`  ${new Date().toLocaleString()}`);
  console.log(`  Actor: ${ACTOR_MODEL} | Judge: ${JUDGE_MODEL}`);
  console.log(`  Scenarios: ${scenarios.length} | Concurrency: ${CONCURRENCY}`);
  console.log(`${"=".repeat(70)}\n`);

  const rows = await mapWithConcurrency(scenarios, CONCURRENCY, async (scenario) => {
    process.stdout.write(`[${scenario.id}] ${scenario.name}... `);
    const row = await runScenario(scenario);
    console.log(
      `${row.passExpected ? "✓" : "✗"} | ${row.totalTurns} turn(s)` +
        (row.judgeScores ? ` | judge=${row.judgeScores.overall}` : " | judge=FAILED"),
    );
    return row;
  });

  const passed = rows.filter((r) => r.passExpected).length;
  const behavioralPassRate = {
    passed,
    total: rows.length,
    percent: Math.round((passed / rows.length) * 100),
  };

  const dims = [
    "smart_quality",
    "communication_quality",
    "safety_compliance",
    "efficiency",
    "overall",
  ] as const;
  const judgeScores = Object.fromEntries(
    dims.map((dim) => [
      dim,
      parseFloat(
        mean(rows.map((r) => r.judgeScores?.[dim]).filter((v): v is number => v != null)).toFixed(2),
      ),
    ]),
  ) as Baseline["judgeScores"];

  const actorTotal = rows.reduce((acc, r) => addUsage(acc, r.actorUsage), {
    promptTokens: 0,
    completionTokens: 0,
  });
  const judgeTotal = rows.reduce((acc, r) => addUsage(acc, r.judgeUsage), {
    promptTokens: 0,
    completionTokens: 0,
  });
  const estimatedCostUsd =
    Math.round((costOf(ACTOR_MODEL, actorTotal) + costOf(JUDGE_MODEL, judgeTotal)) * 10000) / 10000;

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(
    RUN_JSON_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        commitSha: currentCommitSha(),
        actorModel: ACTOR_MODEL,
        judgeModel: JUDGE_MODEL,
        behavioralPassRate,
        judgeScores,
        estimatedCostUsd,
        actorTokenUsage: actorTotal,
        judgeTokenUsage: judgeTotal,
        scenarios: rows,
      },
      null,
      2,
    ),
  );
  console.log(`\nJSON results → ${RUN_JSON_PATH}`);

  if (PROMOTE) {
    const baseline: Baseline = {
      generatedAt: new Date().toISOString(),
      commitSha: currentCommitSha(),
      actorModel: ACTOR_MODEL,
      judgeModel: JUDGE_MODEL,
      behavioralPassRate,
      judgeScores,
    };
    writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
    console.log(`Baseline promoted → ${BASELINE_PATH}`);
    return;
  }

  const baseline = loadBaseline();

  const lines: string[] = [];
  lines.push("## Camay Eval Gate");
  lines.push("");
  lines.push(`Actor: \`${ACTOR_MODEL}\` · Judge: \`${JUDGE_MODEL}\` · Scenarios: ${rows.length}`);
  lines.push("");
  lines.push(`**Behavioral pass rate:** ${behavioralPassRate.passed}/${behavioralPassRate.total} (${behavioralPassRate.percent}%)`);
  lines.push(`**Estimated cost:** $${estimatedCostUsd.toFixed(4)} (actor: ${actorTotal.promptTokens + actorTotal.completionTokens} tokens, judge: ${judgeTotal.promptTokens + judgeTotal.completionTokens} tokens)`);
  lines.push("");
  lines.push("| Dimension | Current | Baseline | Delta |");
  lines.push("|---|---|---|---|");

  let regressed = false;
  let regressionReasons: string[] = [];

  if (!baseline) {
    lines.push("| _(no baseline.json found — nothing to compare against)_ | | | |");
    for (const dim of dims) {
      lines.push(`| ${dim} | ${judgeScores[dim]} | — | — |`);
    }
  } else {
    for (const dim of dims) {
      const delta = judgeScores[dim] - baseline.judgeScores[dim];
      lines.push(
        `| ${dim} | ${judgeScores[dim]} | ${baseline.judgeScores[dim]} | ${delta >= 0 ? "+" : ""}${delta.toFixed(2)} |`,
      );
    }

    const passRateDrop = baseline.behavioralPassRate.percent - behavioralPassRate.percent;
    const overallDrop = baseline.judgeScores.overall - judgeScores.overall;

    if (passRateDrop > PASS_RATE_DROP_THRESHOLD_PCT) {
      regressed = true;
      regressionReasons.push(
        `Behavioral pass rate dropped ${passRateDrop} points (${baseline.behavioralPassRate.percent}% → ${behavioralPassRate.percent}%), threshold is ${PASS_RATE_DROP_THRESHOLD_PCT}`,
      );
    }
    if (overallDrop > JUDGE_SCORE_DROP_THRESHOLD) {
      regressed = true;
      regressionReasons.push(
        `Average judge score dropped ${overallDrop.toFixed(2)} (${baseline.judgeScores.overall} → ${judgeScores.overall}), threshold is ${JUDGE_SCORE_DROP_THRESHOLD}`,
      );
    }
  }

  lines.push("");
  if (!baseline) {
    lines.push("ℹ️ No baseline present — run the `promote-baseline` workflow to seed one. This check passes by default until then.");
  } else if (regressed) {
    lines.push("### ❌ Regression detected");
    for (const reason of regressionReasons) lines.push(`- ${reason}`);
  } else {
    lines.push("### ✅ No regression vs. baseline");
  }

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(REPORT_MD_PATH, lines.join("\n") + "\n");
  console.log(`Markdown report → ${REPORT_MD_PATH}\n`);
  console.log(lines.join("\n"));

  if (regressed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("CI eval gate failed:", err);
  process.exit(1);
});
