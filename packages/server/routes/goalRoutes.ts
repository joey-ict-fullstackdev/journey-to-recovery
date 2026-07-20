import express from "express";
import type { Request, Response } from "express";
import connection from "../db/connection";
import { authenticateToken, validateBody } from "../middleware/auth";
import { goalSchema } from "../utilities/schema";

const goalRoutes = express.Router();

goalRoutes.post(
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

export default goalRoutes;
