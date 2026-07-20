import express from "express";
import type { Request, Response } from "express";
import connection from "../db/connection";
import { authenticateToken, validateBody } from "../middleware/auth";
import { profileFormSchema } from "../utilities/schema";

const profileRoutes = express.Router();

profileRoutes.post(
  "/profile",
  authenticateToken,
  validateBody(profileFormSchema),
  async (req: Request, res: Response) => {
    const user = (req as any).user;

    if (!user) {
      res.status(401).json({ message: "UnAuthorized." });
    }

    const { displayName, dateOfBirth, gender, meditationExperience } = req.body;

    try {
      await connection.execute(
        "UPDATE user SET name = ?, dob = ?, gender = ?, meditation_level = ? WHERE id = ?",
        [displayName, dateOfBirth, gender, meditationExperience, user.id],
      );
    } catch (err) {
      res.status(500).json({ message: "Server error to update user info." });
    }

    res.status(200).json({ message: "Updated successfully." });
  },
);

profileRoutes.get(
  "/profile",
  authenticateToken,
  async (req: Request, res: Response) => {
    const user = (req as any).user;

    if (!user) {
      res.status(401).json({ message: "UnAuthorized." });
    }

    try {
      const [rows] = await connection.execute(
        "Select id, email, name, dob, gender, meditation_level From user where id = ?",
        [user.id],
      );

      if ((rows as any).length === 0) {
        return res.status(404).json({ message: "User not found." });
      }

      const userInfo = (rows as any)[0];
      res.status(200).json({ userInfo });
    } catch (err) {
      console.error("Failed to fetch user data:", err);
      res.status(500).json({ message: "Server error to fetch user info." });
    }
  },
);

export default profileRoutes;
