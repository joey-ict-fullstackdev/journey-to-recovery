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
      const [existing] = await db
        .select({ id: alerts.id, status: alerts.status })
        .from(alerts)
        .where(eq(alerts.id, req.params.id));

      if (!existing) {
        return res.status(404).json({ message: "Alert not found" });
      }

      // Guard backward transition: acknowledged cannot follow resolved.
      if (status === "acknowledged" && existing.status === "resolved") {
        return res.status(400).json({ message: "Cannot re-acknowledge a resolved alert" });
      }

      await db
        .update(alerts)
        .set({
          ...(status !== undefined && { status }),
          ...(clinicianNote !== undefined && { clinicianNote }),
          // Only stamp on the first transition to acknowledged — never overwrite the original auditor.
          ...(status === "acknowledged" && existing.status !== "acknowledged" && {
            acknowledgedBy: user.id,
            acknowledgedAt: new Date(),
          }),
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
