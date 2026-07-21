import express from "express";
import type { Request, Response } from "express";
import { db } from "../db/connection";
// Aliased: this file's route handlers already use `user` for the
// authenticated JWT payload (req.user), matching every other migrated route.
import { user as userTable } from "../db/schema";
import { eq } from "drizzle-orm";
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
      await db
        .update(userTable)
        .set({
          name: displayName,
          dob: dateOfBirth,
          gender,
          meditationLevel: meditationExperience,
        })
        .where(eq(userTable.id, user.id));
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
      // Field keys below intentionally match the raw SQL's original column
      // names (snake_case), not Drizzle's camelCase TS property names —
      // the client destructures `userInfo.meditation_level` directly, so
      // the response wire shape must stay exactly as it was.
      const rows = await db
        .select({
          id: userTable.id,
          email: userTable.email,
          name: userTable.name,
          dob: userTable.dob,
          gender: userTable.gender,
          meditation_level: userTable.meditationLevel,
          role: userTable.role,
        })
        .from(userTable)
        .where(eq(userTable.id, user.id));

      if (rows.length === 0) {
        return res.status(404).json({ message: "User not found." });
      }

      const userInfo = rows[0];
      res.status(200).json({ userInfo });
    } catch (err) {
      console.error("Failed to fetch user data:", err);
      res.status(500).json({ message: "Server error to fetch user info." });
    }
  },
);

export default profileRoutes;
