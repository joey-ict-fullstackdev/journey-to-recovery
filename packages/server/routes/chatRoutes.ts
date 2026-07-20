import express from "express";
import type { Request, Response } from "express";
import connection from "../db/connection";
import { authenticateToken, validateBody } from "../middleware/auth";
import { chatSchema } from "../utilities/schema";
import type { RowDataPacket } from "mysql2/promise";
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
      const [rows] = await connection.execute(
        "SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC",
        [user.id],
      );
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

      const [conversations] = await connection.execute<RowDataPacket[]>(
        "SELECT id FROM conversations WHERE id = ? AND user_id = ?",
        [conversationId, user.id],
      );

      if (conversations.length === 0) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const [messages] = await connection.query(
        "SELECT content, role FROM messages WHERE conversation_id = ? ORDER BY created_at ASC",
        [conversationId],
      );

      res.json(messages);
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

    const chatConnection = await connection.getConnection();

    try {
      await chatConnection.beginTransaction();

      const [existingConv] = await chatConnection.query<RowDataPacket[]>(
        "SELECT id FROM conversations WHERE id = ?",
        [conversationId],
      );

      if (existingConv.length === 0) {
        await chatConnection.query(
          "INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)",
          [conversationId, user.id, generateTitle(prompt)],
        );
      } else {
        await chatConnection.query(
          "UPDATE conversations SET updated_at = NOW() WHERE id = ?",
          [conversationId],
        );
      }

      await chatConnection.query(
        "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
        [conversationId, "user", prompt],
      );

      const historyLimit = 15;
      const [historyRows] = await chatConnection.query<RowDataPacket[]>(
        "SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?",
        [conversationId, historyLimit],
      );

      // const historyForGemini = historyRows.reverse().map((msg: any) => ({
      //   role: msg.role === "bot" ? "model" : "user",
      //   parts: [{ text: msg.content }],
      // }));

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
        await chatConnection.query(
          `INSERT INTO chat_goals (
            id, conversation_id, user_id, goal_summary, goal_category,
            target_activity, current_ability,
            measurement_metric, measurement_current_val, measurement_target_val, measurement_unit,
            frequency, timeline_weeks, assistance_level,
            is_specific, is_measurable, is_achievable, is_relevant, is_time_bound,
            risk_score, risk_level, requires_approval
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            goalId,
            conversationId,
            user.id,
            parsedData.goal_summary,
            parsedData.smart_data.goal_category,
            parsedData.smart_data.target_activity,
            parsedData.smart_data.current_ability,
            m.metric,
            m.current_value,
            m.target_value,
            m.unit,
            parsedData.smart_data.frequency,
            parsedData.smart_data.timeline_weeks,
            parsedData.smart_data.assistance_level,
            sa.is_specific,
            sa.is_measurable,
            sa.is_achievable,
            sa.is_relevant,
            sa.is_time_bound,
            riskAnalysis.score,
            riskAnalysis.level,
            riskAnalysis.requires_approval,
          ],
        );
        await chatConnection.query(
          "UPDATE conversations SET status = 'completed' WHERE id = ?",
          [conversationId],
        );
      }

      await chatConnection.query(
        "INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)",
        [conversationId, "bot", botResponseText],
      );

      await chatConnection.commit();

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
      await chatConnection.rollback();
      console.error("Gemini API Error:", err);
      res.status(500).json({ message: "Error communicating with AI." });
    } finally {
      chatConnection.release();
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

      const [result] = await connection.query<any>(
        "DELETE FROM conversations WHERE id = ? AND user_id = ?",
        [conversationId, user.id],
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
