import express from "express";
import { db } from "../db/connection";
import { alerts, user as userTable } from "../db/schema";
import { eq, ne, desc, count } from "drizzle-orm";
import { alias } from "drizzle-orm/mysql-core";
import { authenticateToken, requireRole, validateBody } from "../middleware/auth";
import { alertUpdateSchema } from "../utilities/schema";

const alertRoutes = express.Router();

// Alias for the user table so GET /history and GET /:id can join both the
// patient (via alerts.userId) and the acknowledging clinician (via alerts.acknowledgedBy).
const clinicianAlias = alias(userTable, "clinician");

// Fields shared by every alert endpoint that JOINs the user table.
const alertSelectBase = {
  id: alerts.id,
  userId: alerts.userId,
  triggerType: alerts.triggerType,
  riskLevel: alerts.riskLevel,
  triggerMessageSnippet: alerts.triggerMessageSnippet,
  status: alerts.status,
  clinicianNote: alerts.clinicianNote,
  createdAt: alerts.createdAt,
  patientName: userTable.name,
  patientEmail: userTable.email,
};

alertRoutes.get(
  "/alerts",
  authenticateToken,
  requireRole("clinician"),
  async (_req, res) => {
    try {
      res.json(
        await db
          .select({ ...alertSelectBase, riskScore: alerts.riskScore, updatedAt: alerts.updatedAt })
          .from(alerts)
          .innerJoin(userTable, eq(alerts.userId, userTable.id))
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
  "/alerts/count",
  authenticateToken,
  requireRole("clinician"),
  async (_req, res) => {
    try {
      const [{ total }] = await db
        .select({ total: count() })
        .from(alerts)
        .where(eq(alerts.status, "open"));
      res.json({ count: total });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch alert count" });
    }
  },
);

alertRoutes.get(
  "/alerts/history",
  authenticateToken,
  requireRole("clinician"),
  async (_req, res) => {
    try {
      res.json(
        await db
          .select({
            ...alertSelectBase,
            acknowledgedBy: clinicianAlias.email,
            acknowledgedAt: alerts.acknowledgedAt,
            resolvedAt: alerts.resolvedAt,
          })
          .from(alerts)
          .innerJoin(userTable, eq(alerts.userId, userTable.id))
          .leftJoin(clinicianAlias, eq(alerts.acknowledgedBy, clinicianAlias.id))
          .where(ne(alerts.status, "open"))
          .orderBy(desc(alerts.updatedAt)),
      );
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch alert history" });
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
        .select({
          ...alertSelectBase,
          riskScore: alerts.riskScore,
          updatedAt: alerts.updatedAt,
          acknowledgedBy: clinicianAlias.email,
          acknowledgedAt: alerts.acknowledgedAt,
          resolvedAt: alerts.resolvedAt,
        })
        .from(alerts)
        .innerJoin(userTable, eq(alerts.userId, userTable.id))
        .leftJoin(clinicianAlias, eq(alerts.acknowledgedBy, clinicianAlias.id))
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

      if (!existing) return res.status(404).json({ message: "Alert not found" });

      // Guard backward transition: acknowledged cannot follow resolved.
      if (status === "acknowledged" && existing.status === "resolved")
        return res.status(400).json({ message: "Cannot re-acknowledge a resolved alert" });

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
