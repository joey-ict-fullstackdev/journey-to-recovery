/**
 * Daily alert digest — queries every open alert from the production DB,
 * emails a summary to all clinician accounts via Resend, then exits.
 *
 * Run:  NODE_ENV=production bun run scripts/daily-digest.ts
 * (or via the "digest" npm script, which sets NODE_ENV=production for you)
 *
 * Required env vars: RESEND_API_KEY, RESEND_FROM, plus the Railway MySQL
 * vars used by db/connection.ts when NODE_ENV=production.
 */
import "dotenv/config";
import { Resend } from "resend";
import pool, { db } from "../db/connection";
import { alerts, user } from "../db/schema";
import { eq, desc } from "drizzle-orm";

const TRIGGER_LABELS: Record<string, string> = {
  high_risk_goal: "High-risk goal",
  risk_flag_message: "Safety flag",
};

function esc(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtml(rows: typeof openAlerts): string {
  const rows_html = rows
    .map(
      (a) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:${
        a.riskLevel === "HIGH" ? "#b91c1c" : a.riskLevel === "MODERATE" ? "#92400e" : "#374151"
      }">${esc(a.riskLevel)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${esc(TRIGGER_LABELS[a.triggerType ?? ""] ?? a.triggerType)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${esc(a.patientName ? `${a.patientName} <${a.patientEmail}>` : a.patientEmail)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-style:italic;color:#6b7280">${esc(a.triggerMessageSnippet)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;white-space:nowrap;color:#6b7280">${new Date(a.createdAt).toUTCString()}</td>
    </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;color:#111827;max-width:700px;margin:0 auto;padding:24px">
  <h2 style="margin-bottom:4px">Journey to Recovery — Alert Digest</h2>
  <p style="color:#6b7280;margin-top:0">${rows.length} open alert${rows.length !== 1 ? "s" : ""} awaiting clinician review.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead>
      <tr style="background:#f9fafb;text-align:left">
        <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb">Risk</th>
        <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb">Type</th>
        <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb">Patient</th>
        <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb">Message snippet</th>
        <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb">Created</th>
      </tr>
    </thead>
    <tbody>${rows_html}</tbody>
  </table>
  <p style="font-size:12px;color:#9ca3af;margin-top:24px">
    Log in to review and action these alerts. This digest is sent daily while open alerts exist.
  </p>
</body>
</html>`;
}

const [openAlerts, clinicians] = await Promise.all([
  db
    .select({
      id: alerts.id,
      triggerType: alerts.triggerType,
      riskLevel: alerts.riskLevel,
      triggerMessageSnippet: alerts.triggerMessageSnippet,
      createdAt: alerts.createdAt,
      patientName: user.name,
      patientEmail: user.email,
    })
    .from(alerts)
    .innerJoin(user, eq(alerts.userId, user.id))
    .where(eq(alerts.status, "open"))
    .orderBy(desc(alerts.createdAt)),

  db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.role, "clinician")),
]);

if (openAlerts.length === 0) {
  console.log("No open alerts — skipping digest.");
  await pool.end();
  process.exit(0);
}

if (clinicians.length === 0) {
  const fallback = process.env.DIGEST_FALLBACK_EMAIL;
  if (fallback) {
    clinicians.push({ email: fallback });
    console.warn(`No clinician accounts found — falling back to ${fallback}.`);
  } else {
    console.warn("No clinician accounts found — no digest sent. Set DIGEST_FALLBACK_EMAIL to override.");
    await pool.end();
    process.exit(1);
  }
}

const to = clinicians.map((c) => c.email);
const resend = new Resend(process.env.RESEND_API_KEY);

const { error } = await resend.emails.send({
  from: process.env.RESEND_FROM ?? "alerts@resend.dev",
  to,
  subject: `[Journey to Recovery] ${openAlerts.length} open alert${openAlerts.length !== 1 ? "s" : ""} awaiting review`,
  html: buildHtml(openAlerts),
});

if (error) {
  console.error("Resend error:", error);
  await pool.end();
  process.exit(1);
}

console.log(`Digest sent to ${to.join(", ")} — ${openAlerts.length} alert(s).`);
await pool.end();
process.exit(0);
