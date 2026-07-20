import express from "express";
import type { Request, Response } from "express";
import connection from "../db/connection";
import { authenticateToken, validateBody } from "../middleware/auth";
import {
  goalSchema,
  wellnessSchema,
  chatSchema,
} from "../utilities/schema";
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

const userRoutes = express.Router();

function toYYYYMMDD(date: Date): string {
  return date.toISOString().split("T")[0] || "";
}

userRoutes.post(
  "/goal",
  authenticateToken,
  validateBody(goalSchema),
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const {
      overallGoal,
      smartGoal,
      importance,
      motivation,
      confidence,
      confidenceReason,
      reminderType,
    } = req.body;

    const goalId = crypto.randomUUID();

    try {
      await connection.execute(
        "INSERT INTO goal (id, user_id, overall_goal, smart_goal, importance, motivation, confidence, confidence_reason, reminder_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          goalId,
          user.id,
          overallGoal || null,
          smartGoal,
          importance || null,
          motivation || null,
          confidence || null,
          confidenceReason || null,
          reminderType || "none",
        ],
      );
      res.status(201).json({ message: "Goal saved successfully." });
    } catch (err: any) {
      console.error("Failed to save goal:", err);
      return res.status(500).json({ message: "Server error saving goal." });
    }
  },
);

userRoutes.post(
  "/wellness-summary",
  authenticateToken,
  validateBody(wellnessSchema),
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { wellnessRatings, wellnessExplanations, focusArea, strengths } =
      req.body;

    const wellnessId = crypto.randomUUID();

    const dbData = {
      id: wellnessId,
      user_id: user.id,
      social_rating: wellnessRatings.social || null,
      social_explanation: wellnessExplanations.social || null,
      physical_rating: wellnessRatings.physical || null,
      physical_explanation: wellnessExplanations.physical || null,
      environment_rating: wellnessRatings.environment || null,
      environment_explanation: wellnessExplanations.environment || null,
      financial_rating: wellnessRatings.financial || null,
      financial_explanation: wellnessExplanations.financial || null,
      work_rating: wellnessRatings.work || null,
      work_explanation: wellnessExplanations.work || null,
      spiritual_rating: wellnessRatings.spiritual || null,
      spiritual_explanation: wellnessExplanations.spiritual || null,
      recreation_rating: wellnessRatings.recreation || null,
      recreation_explanation: wellnessExplanations.recreation || null,
      mental_rating: wellnessRatings.mental || null,
      mental_explanation: wellnessExplanations.mental || null,
      focus_area: focusArea,
      strengths_values: strengths.values || null,
      strengths_good_at: strengths.goodAt || null,
      strengths_overcome: strengths.overcome || null,
      strengths_valued_for: strengths.valuedFor || null,
    };

    try {
      const sqlQuery = `
        INSERT INTO wellness_wheel (
          id, user_id, 
          social_rating, social_explanation,
          physical_rating, physical_explanation,
          environment_rating, environment_explanation,
          financial_rating, financial_explanation,
          work_rating, work_explanation,
          spiritual_rating, spiritual_explanation,
          recreation_rating, recreation_explanation,
          mental_rating, mental_explanation,
          focus_area, strengths_values, strengths_good_at, strengths_overcome, strengths_valued_for
        ) VALUES (
          :id, :user_id,
          :social_rating, :social_explanation,
          :physical_rating, :physical_explanation,
          :environment_rating, :environment_explanation,
          :financial_rating, :financial_explanation,
          :work_rating, :work_explanation,
          :spiritual_rating, :spiritual_explanation,
          :recreation_rating, :recreation_explanation,
          :mental_rating, :mental_explanation,
          :focus_area,
          :strengths_values, :strengths_good_at, :strengths_overcome, :strengths_valued_for
        )
      `;

      await connection.execute(sqlQuery, dbData);
      res.status(201).json({ message: "Wellness summary saved successfully." });
    } catch (err: any) {
      console.error("Failed to save wellness summary:", err);
      return res.status(500).json({ message: "Server error saving summary." });
    }
  },
);

const generateTitle = (prompt: string) => {
  return prompt.slice(0, 30) + (prompt.length > 30 ? "..." : "");
};

userRoutes.get(
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

userRoutes.get(
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

userRoutes.post(
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

userRoutes.delete(
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

export default userRoutes;
