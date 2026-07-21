import express from "express";
import { db } from "../db/connection";
import { alerts } from "../db/schema";
import { eq, desc } from "drizzle-orm";
import { authenticateToken, requireRole, validateBody } from "../middleware/auth";
import { alertUpdateSchema } from "../utilities/schema";

const alertRoutes = express.Router();

alertRoutes.get(
  "/alerts",
  authenticateToken,
  requireRole("clinician"),
  async (_req, res) => {
    try {
      res.json(
        await db
          .select()
          .from(alerts)
          .where(eq(alerts.status, "open"))
          .orderBy(desc(alerts.createdAt)),
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch alerts" });
    }
  },
);

alertRoutes.get(
  "/alerts/:id",
  authenticateToken,
  requireRole("clinician"),
  async (req, res) => {
    try {
      const [alert] = await db
        .select()
        .from(alerts)
        .where(eq(alerts.id, req.params.id));
      if (!alert) return res.status(404).json({ message: "Alert not found" });
      res.json(alert);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch alert" });
    }
  },
);

alertRoutes.patch(
  "/alerts/:id",
  authenticateToken,
  requireRole("clinician"),
  validateBody(alertUpdateSchema),
  async (req, res) => {
    const { status, clinicianNote } = req.body;
    const user = (req as any).user;

    try {
      const existing = await db
        .select({ id: alerts.id })
        .from(alerts)
        .where(eq(alerts.id, req.params.id));
      if (existing.length === 0) {
        return res.status(404).json({ message: "Alert not found" });
      }

      await db
        .update(alerts)
        .set({
          status,
          ...(clinicianNote !== undefined && { clinicianNote }),
          // acknowledgedBy/acknowledgedAt scoped to the acknowledged transition only —
          // a direct open→resolved skip should not stamp the acknowledged* columns.
          ...(status === "acknowledged" && { acknowledgedBy: user.id, acknowledgedAt: new Date() }),
          ...(status === "resolved" && { resolvedAt: new Date() }),
        })
        .where(eq(alerts.id, req.params.id));

      res.json({ message: "Alert updated" });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update alert" });
    }
  },
);

export default alertRoutes;
