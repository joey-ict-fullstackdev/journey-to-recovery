import express from "express";
import type { Request, Response } from "express";
import { db } from "../db/connection";
import { conversations, messages, chatGoals } from "../db/schema";
import { and, eq, desc, asc } from "drizzle-orm";
import { authenticateToken, validateBody } from "../middleware/auth";
import { chatSchema } from "../utilities/schema";
import { GoogleGenAI } from "@google/genai";
import { OpenAI } from "openai";
import {
  CAMAY_SYSTEM_PROMPT,
  type SMARTGoalResponse,
} from "../utilities/prompt.config";
import { calculateRisk } from "../utilities/riskCalculator";

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
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.id, conversationId));

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

        // ── Step 2: build the chat bubble text ────────────────────
        // Only runs when parsing succeeded (parsedData is not null).
        if (parsedData) {
          riskAnalysis = calculateRisk(parsedData.smart_data);

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

        // ── Step 3: persist goal on completion ────────────────────
        // Runs outside the JSON parse try-catch so that a database
        // error propagates to the outer catch and rolls back the
        // entire transaction, rather than silently falling back to
        // showing raw JSON as the bot message.
        if (parsedData?.conversation_state === "goal_complete" && riskAnalysis) {
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

        return { botResponseText, parsedData, riskAnalysis };
      });

      const { botResponseText, parsedData, riskAnalysis } = result;

      res.status(200).json({
        generatedText: botResponseText,
        conversationState: parsedData?.conversation_state ?? "gathering_info",
        goalData:
          parsedData?.conversation_state === "goal_complete"
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
