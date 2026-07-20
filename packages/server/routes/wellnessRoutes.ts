import express from "express";
import type { Request, Response } from "express";
import connection from "../db/connection";
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

export default wellnessRoutes;
