import express from "express";
import type { Request, Response } from "express";
import { db } from "../db/connection";
import { goal } from "../db/schema";
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
      await db.insert(goal).values({
        id: goalId,
        userId: user.id,
        overallGoal: overallGoal || null,
        smartGoal,
        importance: importance || null,
        motivation: motivation || null,
        confidence: confidence || null,
        confidenceReason: confidenceReason || null,
        reminderType: reminderType || "none",
      });
      res.status(201).json({ message: "Goal saved successfully." });
    } catch (err: any) {
      console.error("Failed to save goal:", err);
      return res.status(500).json({ message: "Server error saving goal." });
    }
  },
);

export default goalRoutes;
