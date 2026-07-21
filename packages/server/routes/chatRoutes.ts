import express from "express";
import type { Request, Response } from "express";
import { db } from "../db/connection";
import { conversations, messages, chatGoals, alerts } from "../db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { authenticateToken, validateBody } from "../middleware/auth";
import { chatSchema } from "../utilities/schema";
import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import {
  CAMAY_SYSTEM_PROMPT,
  type SMARTGoalResponse,
} from "../utilities/prompt.config";
import { calculateRisk, type RiskAssessment } from "../utilities/riskCalculator";

let ai: any;
if (process.env.EVAL_MODEL === "gemini-2.5-flash") {
  ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} else {
  ai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const chatRoutes = express.Router();

const generateTitle = (prompt: string) => {
  return prompt.slice(0, 30) + (prompt.length > 30 ? "..." : "");
};

type ChatTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Named-object params, not positional — four of the fields are
// string-shaped, so a positional swap (e.g. userId/conversationId) would
// type-check silently. Matches this file's own convention of named-key
// .values({...}) object literals for every other multi-field DB write.
async function createAlert(
  tx: ChatTransaction,
  params: {
    userId: string;
    conversationId: string;
    triggerType: "risk_flag_message" | "high_risk_goal";
    chatGoalId: string | null;
    triggerMessageSnippet: string;
    risk: RiskAssessment;
  },
): Promise<{ id: string; triggerType: string }> {
  const { userId, conversationId, triggerType, chatGoalId, triggerMessageSnippet, risk } =
    params;
  const id = crypto.randomUUID();
  await tx.insert(alerts).values({
    id,
    userId,
    conversationId,
    chatGoalId,
    triggerType,
    // riskScore stays the real goal-ambition number from calculateRisk()
    // for reference, but riskLevel is forced to HIGH for risk_flag_message
    // alerts — risk_flag is Camay's own binary safety signal (CRITICAL
    // SAFETY RULES in prompt.config.ts), not a graded one, and
    // calculateRisk scores goal ambition, not safety severity. A first
    // message mentioning chest pain before any goal is drafted would
    // otherwise score near-zero/LOW here, since smart_data is still
    // placeholder.
    riskScore: risk.score,
    riskLevel: triggerType === "risk_flag_message" ? "HIGH" : risk.level,
    triggerMessageSnippet,
  });
  return { id, triggerType };
}

chatRoutes.get(
  "/conversations",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      // Field keys intentionally match the raw SQL's original column names
      // (snake_case) — the client (ChatSidebar.tsx) reads `updated_at`
      // directly from this response, so the wire shape must stay as-is.
      const rows = await db
        .select({
          id: conversations.id,
          user_id: conversations.userId,
          title: conversations.title,
          status: conversations.status,
          created_at: conversations.createdAt,
          updated_at: conversations.updatedAt,
        })
        .from(conversations)
        .where(eq(conversations.userId, user.id))
        .orderBy(desc(conversations.updatedAt));
      res.json(rows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch history" });
    }
  },
);

chatRoutes.get(
  "/conversations/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const conversationId = req.params.id;
      const user = (req as any).user;

      const convRows = await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, user.id),
          ),
        );

      if (convRows.length === 0) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const messageRows = await db
        .select({ content: messages.content, role: messages.role })
        .from(messages)
        .where(eq(messages.conversationId, conversationId))
        .orderBy(asc(messages.createdAt));

      res.json(messageRows);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch messages" });
    }
  },
);

chatRoutes.post(
  "/chat",
  authenticateToken,
  validateBody(chatSchema),
  async (req: Request, res: Response) => {
    const { prompt, conversationId } = req.body;
    const user = (req as any).user;

    if (!prompt) {
      return res.status(400).json({ message: "Prompt is required." });
    }

    try {
      // The AI call (a slow external network request) runs inside this
      // transaction, same as it did in the original raw-SQL version — not
      // great practice, but preserving exact existing behavior, not fixing
      // it as a side effect of this migration.
      const result = await db.transaction(async (tx) => {
        const existingConv = await tx
          .select({
            id: conversations.id,
            status: conversations.status,
            userId: conversations.userId,
          })
          .from(conversations)
          .where(eq(conversations.id, conversationId));

        // Distinguish "doesn't exist yet" (→ insert below) from "exists but
        // isn't mine" (→ reject) — a single WHERE id=? AND userId=? would
        // collapse both to zero rows and wrongly fall into the insert
        // branch, crashing on a colliding primary key instead of a clean 404.
        // Returned (not thrown) since nothing has been written yet — this is
        // an expected, handled outcome, not a failure to roll back — same
        // idiom as goalPersistedThisTurn below for threading a result out.
        if (existingConv.length > 0 && existingConv[0]!.userId !== user.id) {
          return { conversationNotFound: true as const };
        }

        // Read before this turn's writes — used below to stop a resubmitted
        // or duplicate turn from re-persisting a goal/alert for a
        // conversation that already reached goal_complete once.
        const wasAlreadyCompleted = existingConv[0]?.status === "completed";

        if (existingConv.length === 0) {
          await tx.insert(conversations).values({
            id: conversationId,
            userId: user.id,
            title: generateTitle(prompt),
          });
        } else {
          await tx
            .update(conversations)
            .set({ updatedAt: new Date() })
            .where(eq(conversations.id, conversationId));
        }

        await tx.insert(messages).values({
          conversationId,
          role: "user",
          content: prompt,
        });

        const historyLimit = 15;
        const historyRows = await tx
          .select({ role: messages.role, content: messages.content })
          .from(messages)
          .where(eq(messages.conversationId, conversationId))
          .orderBy(desc(messages.createdAt))
          .limit(historyLimit);

        let response: any;

        if (process.env.EVAL_MODEL === "gemini-2.5-flash") {
          const historyForGemini = historyRows.reverse().map((msg: any) => ({
            role: msg.role === "bot" ? "model" : "user",
            parts: [{ text: msg.content }],
          }));

          response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: historyForGemini,
            config: {
              maxOutputTokens: 5000,
              temperature: 0.2,
              systemInstruction: CAMAY_SYSTEM_PROMPT,
              responseMimeType: "application/json",
            },
          });
        } else {
          const historyForOpenAI = historyRows.reverse().map((msg: any) => ({
            role: (msg.role === "bot" ? "assistant" : "user") as
              | "assistant"
              | "user",
            content: msg.content as string,
          }));

          response = await (ai as OpenAI).chat.completions.create({
            model: "gpt-5.4-nano",
            messages: [
              { role: "system", content: CAMAY_SYSTEM_PROMPT },
              ...historyForOpenAI,
            ],
            max_completion_tokens: 5000,
            temperature: 0.2,
            response_format: { type: "json_object" },
          });
        }

        const rawText =
          process.env.EVAL_MODEL === "gemini-2.5-flash"
            ? response.text
            : (response.choices?.[0]?.message?.content ?? "");

        if (!rawText) {
          throw new Error("No response text from AI model");
        }

        let botResponseText = "";
        let riskAnalysis = null;
        let parsedData: SMARTGoalResponse | null = null;
        const createdAlerts: { id: string; triggerType: string }[] = [];
        // Set exactly where the goal is actually persisted below (Step 3),
        // so the response block doesn't have to independently re-derive
        // the same condition a second time and risk drifting from it.
        let goalPersistedThisTurn = false;

        // ── Step 1: parse the AI's JSON response ──────────────────
        // Only JSON-related errors are caught here. Database errors
        // must NOT be caught here — they should roll back the whole
        // transaction via the outer catch block.
        try {
          const firstBrace = rawText.indexOf("{");
          const lastBrace = rawText.lastIndexOf("}");

          if (firstBrace === -1 || lastBrace === -1) {
            throw new Error("No JSON object found in response");
          }

          parsedData = JSON.parse(
            rawText.substring(firstBrace, lastBrace + 1),
          ) as SMARTGoalResponse;
        } catch (parseError) {
          console.error("JSON Parse Error:", parseError);
          // Fallback: show the raw text so the user still gets a response
          botResponseText = rawText;
        }

        // ── Step 2: build the chat bubble text (+ alert on risk_flag) ──
        // Only runs when parsing succeeded (parsedData is not null).
        if (parsedData) {
          riskAnalysis = calculateRisk(parsedData.smart_data);

          // A mid-conversation safety flag (e.g. mentioned pain/dizziness)
          // is independent of conversation_state/goal completion — it can
          // fire on the very first "gathering_info" turn, so this alert is
          // created here rather than alongside the goal_complete branch
          // below.
          if (parsedData.risk_flag) {
            createdAlerts.push(
              await createAlert(tx, {
                userId: user.id,
                conversationId,
                triggerType: "risk_flag_message",
                chatGoalId: null,
                triggerMessageSnippet: prompt,
                risk: riskAnalysis,
              }),
            );
          }

          // Start with the warm conversational message
          botResponseText = parsedData.user_communication.message;

          const showSummary =
            ["drafting_goal", "refining_goal", "goal_complete"].includes(
              parsedData.conversation_state,
            ) && parsedData.goal_summary;

          if (showSummary) {
            botResponseText += `\n\n**Goal Summary:** ${parsedData.goal_summary}`;
          }

          if (parsedData.user_communication.question) {
            botResponseText += `\n\n${parsedData.user_communication.question}`;
          }

          if (riskAnalysis.level === "HIGH" || parsedData.risk_flag) {
            botResponseText +=
              "\n\n*(Note: This goal seems quite challenging. We will proceed carefully and involve your therapist.)*";
          }
        }

        // ── Step 3: persist goal on completion (+ alert on HIGH risk) ──
        // Runs outside the JSON parse try-catch so that a database
        // error propagates to the outer catch and rolls back the
        // entire transaction, rather than silently falling back to
        // showing raw JSON as the bot message.
        if (
          parsedData?.conversation_state === "goal_complete" &&
          riskAnalysis &&
          !wasAlreadyCompleted
        ) {
          goalPersistedThisTurn = true;
          const goalId = crypto.randomUUID();
          const sa = parsedData.smart_data.smart_assessment;
          const m = parsedData.smart_data.measurement;
          await tx.insert(chatGoals).values({
            id: goalId,
            conversationId,
            userId: user.id,
            goalSummary: parsedData.goal_summary,
            goalCategory: parsedData.smart_data.goal_category,
            targetActivity: parsedData.smart_data.target_activity,
            currentAbility: parsedData.smart_data.current_ability,
            measurementMetric: m.metric,
            measurementCurrentVal: m.current_value,
            measurementTargetVal: m.target_value,
            measurementUnit: m.unit,
            frequency: parsedData.smart_data.frequency,
            timelineWeeks: parsedData.smart_data.timeline_weeks,
            assistanceLevel: parsedData.smart_data.assistance_level,
            isSpecific: sa.is_specific,
            isMeasurable: sa.is_measurable,
            isAchievable: sa.is_achievable,
            isRelevant: sa.is_relevant,
            isTimeBound: sa.is_time_bound,
            riskScore: riskAnalysis.score,
            riskLevel: riskAnalysis.level,
            requiresApproval: riskAnalysis.requires_approval,
          });

          if (riskAnalysis.requires_approval) {
            createdAlerts.push(
              await createAlert(tx, {
                userId: user.id,
                conversationId,
                triggerType: "high_risk_goal",
                chatGoalId: goalId,
                triggerMessageSnippet: parsedData.goal_summary,
                risk: riskAnalysis,
              }),
            );
          }

          await tx
            .update(conversations)
            .set({ status: "completed" })
            .where(eq(conversations.id, conversationId));
        }

        await tx.insert(messages).values({
          conversationId,
          role: "bot",
          content: botResponseText,
        });

        return {
          conversationNotFound: false as const,
          botResponseText,
          parsedData,
          riskAnalysis,
          createdAlerts,
          goalPersistedThisTurn,
        };
      });

      if (result.conversationNotFound) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      // createdAlerts is intentionally unused past this point for now — a
      // later step sends an immediate notification email when it's
      // non-empty, after the transaction has committed.
      const {
        botResponseText,
        parsedData,
        riskAnalysis,
        createdAlerts,
        goalPersistedThisTurn,
      } = result;

      res.status(200).json({
        generatedText: botResponseText,
        conversationState: parsedData?.conversation_state ?? "gathering_info",
        goalData:
          goalPersistedThisTurn && parsedData
            ? {
                summary: parsedData.goal_summary,
                smartData: parsedData.smart_data,
                riskAssessment: riskAnalysis,
              }
            : null,
      });
    } catch (err) {
      console.error("Gemini API Error:", err);
      res.status(500).json({ message: "Error communicating with AI." });
    }
  },
);

chatRoutes.delete(
  "/conversations/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const conversationId = req.params.id;
      const user = (req as any).user;

      const [result] = await db
        .delete(conversations)
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, user.id),
          ),
        );

      if (result.affectedRows === 0) {
        return res
          .status(404)
          .json({ message: "Conversation not found or not authorized" });
      }

      res.json({ message: "Conversation deleted" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to delete conversation" });
    }
  },
);

export default chatRoutes;
