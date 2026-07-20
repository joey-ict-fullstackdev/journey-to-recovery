import express from "express";
import type { Request, Response } from "express";
import { db } from "../db/connection";
import { dailyCheckin } from "../db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { authenticateToken, validateBody } from "../middleware/auth";
import { checkInSchema } from "../utilities/schema";

const checkinRoutes = express.Router();

function getLocalYYYYMMDD(date: Date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

checkinRoutes.get(
  "/check-ins",
  authenticateToken,
  async (req: Request, res: Response) => {
    const user = (req as any).user;

    const today = new Date();
    const dayOfWeek = today.getDay();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - dayOfWeek);

    const weekDates: string[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(weekStart);
      day.setDate(weekStart.getDate() + i);
      weekDates.push(getLocalYYYYMMDD(day));
    }

    try {
      const rows = await db
        .select({ checkinDate: dailyCheckin.checkinDate })
        .from(dailyCheckin)
        .where(
          and(
            eq(dailyCheckin.userId, user.id),
            inArray(dailyCheckin.checkinDate, weekDates),
          ),
        );

      const checkedInDates = new Set(rows.map((row) => row.checkinDate));

      const weekStatus = weekDates.map((date) => checkedInDates.has(date));

      res.status(200).json({ weekStatus });
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: "Server error fetching check-ins." });
    }
  },
);

checkinRoutes.post(
  "/check-in",
  authenticateToken,
  validateBody(checkInSchema),
  async (req: Request, res: Response) => {
    const user = (req as any).user;
    const { status } = req.body;

    const todayDate = getLocalYYYYMMDD(new Date());
    const checkinId = crypto.randomUUID();

    try {
      await db.insert(dailyCheckin).values({
        id: checkinId,
        userId: user.id,
        checkinDate: todayDate,
        status,
      });
      res.status(201).json({ message: "Check-in successful." });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ message: "Server error during check-in." });
    }
  },
);

export default checkinRoutes;
