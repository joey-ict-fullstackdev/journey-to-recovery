import express from "express";
import type { Request, Response } from "express";
import { db } from "../db/connection";
import { wellnessWheel } from "../db/schema";
import { authenticateToken, validateBody } from "../middleware/auth";
import { wellnessSchema } from "../utilities/schema";

const wellnessRoutes = express.Router();

wellnessRoutes.post(
  "/wellness-summary",
  authenticateToken,
  validateBody(wellnessSchema),
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { wellnessRatings, wellnessExplanations, focusArea, strengths } =
      req.body;

    const wellnessId = crypto.randomUUID();

    try {
      await db.insert(wellnessWheel).values({
        id: wellnessId,
        userId: user.id,
        socialRating: wellnessRatings.social || null,
        socialExplanation: wellnessExplanations.social || null,
        physicalRating: wellnessRatings.physical || null,
        physicalExplanation: wellnessExplanations.physical || null,
        environmentRating: wellnessRatings.environment || null,
        environmentExplanation: wellnessExplanations.environment || null,
        financialRating: wellnessRatings.financial || null,
        financialExplanation: wellnessExplanations.financial || null,
        workRating: wellnessRatings.work || null,
        workExplanation: wellnessExplanations.work || null,
        spiritualRating: wellnessRatings.spiritual || null,
        spiritualExplanation: wellnessExplanations.spiritual || null,
        recreationRating: wellnessRatings.recreation || null,
        recreationExplanation: wellnessExplanations.recreation || null,
        mentalRating: wellnessRatings.mental || null,
        mentalExplanation: wellnessExplanations.mental || null,
        focusArea,
        strengthsValues: strengths.values || null,
        strengthsGoodAt: strengths.goodAt || null,
        strengthsOvercome: strengths.overcome || null,
        strengthsValuedFor: strengths.valuedFor || null,
      });
      res.status(201).json({ message: "Wellness summary saved successfully." });
    } catch (err: any) {
      console.error("Failed to save wellness summary:", err);
      return res.status(500).json({ message: "Server error saving summary." });
    }
  },
);

export default wellnessRoutes;
