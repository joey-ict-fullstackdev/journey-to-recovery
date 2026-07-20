import express from "express";
import type { Request, Response } from "express";
import connection from "../db/connection";
import { authenticateToken, validateBody } from "../middleware/auth";
import { checkInSchema } from "../utilities/schema";
import type { RowDataPacket } from "mysql2/promise";

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
      const placeholders = weekDates.map(() => "?").join(",");

      const sqlQuery = `
        SELECT checkin_date 
        FROM daily_checkin 
        WHERE user_id = ? AND checkin_date IN (${placeholders})
      `;

      const sqlValues = [user.id, ...weekDates];

      const [rows] = await connection.execute<RowDataPacket[]>(
        sqlQuery,
        sqlValues,
      );

      const checkedInDates = new Set(rows.map((row) => row.checkin_date));

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
      await connection.execute(
        "INSERT INTO daily_checkin (id, user_id, checkin_date, status) VALUES (?, ?, ?, ?)",
        [checkinId, user.id, todayDate, status],
      );
      res.status(201).json({ message: "Check-in successful." });
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ message: "Server error during check-in." });
    }
  },
);

export default checkinRoutes;
