# Handoff: CI Eval Gate for prompt.config.ts changes

Context for whoever picks this up: the project already had a 92-scenario LLM eval harness (`packages/server/tests/evaluation/scenarios.ts` + `ChatSimulator.ts`) plus a manual, thesis-grade measurement pipeline (`generate-excel.ts` → `fill-excel.ts` ×5 → `judge-excel.ts` → `aggregate.ts`, 5 runs/scenario, GPT+Gemini dual judge). This session added a *separate*, cheap, automated gate: any PR touching `packages/server/utilities/prompt.config.ts` now runs the harness once (Gemini-only judge) via GitHub Actions and blocks merge on regression. The code side is done and committed; what's left is finishing the one-time GitHub setup (secrets, branch protection) and confirming the very first live run.

## Done (all committed, per `git log` — latest is `adf809f`)

1. `ChatSimulator.ts` — added token-usage capture (`TokenUsage`/`SimulationTurn.usage`) for both the OpenAI and Gemini branches, needed for CI cost reporting.
2. `llmJudge.ts` — added `judgeWithGeminiUsage()` (returns `{ scores, usage }`) backed by a new shared `callGeminiJudge()` helper. Deliberately did **not** change `judgeWithGemini`'s existing signature, since `judge-excel.ts` already calls it and expects the original `JudgeScores | null` shape — confirmed via `tsc --noEmit` that this pipeline still type-checks untouched.
3. `tests/evaluation/ci-eval.ts` (new) — the CI entry point: bounded-concurrency (default 5) single pass over all 92 scenarios, OpenAI actor / Gemini judge, behavioral pass-rate + per-dimension score aggregation, cost estimate, baseline comparison with named regression thresholds (`PASS_RATE_DROP_THRESHOLD_PCT = 3`, `JUDGE_SCORE_DROP_THRESHOLD = 0.25`), writes `results/ci-run.json` + `results/ci-report.md`, supports `--promote` to overwrite the baseline instead of comparing.
4. `tests/evaluation/baseline.json` (new, committed, not gitignored) — **already promoted with real numbers** (92/92 pass, judge scores ~3.8–4.8 range) via a local `bun run eval:ci -- --promote` run, not through the GitHub workflow.
5. `.github/workflows/eval-gate.yml` (new) — `pull_request` trigger, path-filtered to `prompt.config.ts`; runs `ci-eval.ts`, uploads results as an artifact, posts a sticky PR comment, fails the job if `ci-eval.ts` exits non-zero.
6. `.github/workflows/promote-baseline.yml` (new) — `workflow_dispatch`-only (never runs on `pull_request`, so a bad PR can't silently redefine "good"); re-runs the eval with `--promote` and commits the updated `baseline.json` back to the chosen ref.
7. `packages/server/package.json` — added `"eval:ci"` script.
8. `CLAUDE.md` — documents the whole gate (trigger, scope, judge model, thresholds, baseline promotion, required secrets) plus two gotchas from this session (see below) — already up to date, don't re-add.
9. `ci-eval.ts`'s per-token pricing constants were placeholders initially; replaced with real rates fetched from the official pricing pages (`gpt-5.4-nano`: $0.20/$1.25 in/out per 1M tokens; `gemini-2.5-flash`: $0.30/$2.50), dated 2026-07-21 in a code comment.

## In flight / open

**Right now:** a PR from branch `ci/trigger-eval-gate` (commit `adf809f`, a no-op comment fix in `prompt.config.ts`) is open specifically to make GitHub register the `eval-gate` check for the first time — see Gotchas below for why this was necessary. The user just confirmed the `eval-gate` job is running as of this handoff. Its pass/fail outcome doesn't matter for the immediate goal (registering the check); it just needs to complete once.

**Next, once that run finishes:**
1. Confirm `OPENAI_API_KEY` and `GEMINI_API_KEY` are actually set as GitHub Actions repo secrets (Settings → Secrets and variables → Actions) — this was guided but never directly confirmed as done. If they're missing, the run will have failed fast at `ci-eval.ts`'s key-check guard (still fine — it registers as a completed check either way).
2. Go to `https://github.com/joey-ict-fullstackdev/journey-to-recovery/settings/branch_protection_rules/80523450`, search "eval" in the "Search for status checks" box under "Require status checks to pass before merging" — `eval-gate` should now be selectable (it wasn't before this PR — see Gotchas). Select it, save.
3. Merge or close the `ci/trigger-eval-gate` PR (it's a harmless no-op comment fix either way).
4. `promote-baseline.yml` itself has never actually been exercised through GitHub Actions (the current `baseline.json` came from a local run) — not a blocker, just untested as a workflow.
5. Offered to re-verify the branch-protection page via Chrome once the user confirms the PR merged/check registered — not yet done as of this handoff.

## Gotchas hit this session

- **GitHub won't let you require a status check that has never run.** The "search for status checks" box in branch protection settings only lists checks that have executed at least once (within the last week) for the repo — it does not read available checks from workflow YAML alone. Confirmed via Chrome: before any PR had touched `prompt.config.ts`, the box said "No checks have been added" and the Actions tab showed **0 workflow runs** for both `eval-gate.yml` and `promote-baseline.yml`, even though GitHub recognized both workflows (they appeared in the left-hand workflow list, meaning the YAML parsed fine and was merged to `main`). Since `eval-gate.yml` intentionally has no `workflow_dispatch` trigger (only `pull_request`), the only way to register it was to open a real PR touching `prompt.config.ts` — hence the `ci/trigger-eval-gate` branch.
- **Testing "missing API key" behavior by clearing the shell env doesn't work and is dangerous.** Tried `env -i bash -c '...bun run ci-eval.ts...'` to verify the fail-fast guard for a missing `GEMINI_API_KEY`. It didn't test what was intended: `ci-eval.ts` (like every script in `tests/evaluation/`) calls `dotenv.config()` pointing directly at `packages/server/.env`, which loads real keys regardless of the shell environment. This accidentally kicked off a live, billed 92-scenario run against real OpenAI/Gemini keys. Caught via a 30s command timeout, confirmed the background `bun` process was still alive via `ps aux`, and killed it (`kill -9`) before it produced any output files. Cost was negligible (a handful of partial-scenario calls on cheap nano/flash-tier models) but real. **To test this path safely in the future: temporarily rename/move `.env`, never rely on shell-env clearing.**
- `gh` CLI is not installed on this machine (Windows, git-bash) — `gh pr create` failed with "command not found". Fell back to the GitHub web compare URL (`.../compare/main...branch-name`) to open the PR instead.
- Mid-instruction, the user had created the branch and edited `prompt.config.ts` but the `git commit` step never actually landed before they hit the `gh` error — `git status` still showed the file as unstaged/modified, and the pushed branch pointed at the same commit as `main`. Worth double-checking `git log`/`git status` rather than assuming a multi-command sequence fully completed, especially when a later command in the sequence errors.

## Useful verification commands

```bash
cd packages/server
bunx tsc --noEmit -p tsconfig.json   # confirm no new type errors (filter for ci-eval/ChatSimulator/llmJudge)
bun run eval:ci                       # local dry run — WARNING: hits real APIs if .env has real keys, costs money
```

```bash
git log --oneline -5                  # confirm what's actually landed vs. in-progress
git status --short                    # confirm nothing stuck mid-sequence (see gotcha above)
```

Branch protection page: `https://github.com/joey-ict-fullstackdev/journey-to-recovery/settings/branch_protection_rules/80523450`
Actions tab: `https://github.com/joey-ict-fullstackdev/journey-to-recovery/actions`
