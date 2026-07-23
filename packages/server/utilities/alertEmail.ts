import { Resend } from "resend";
import { db } from "../db/connection";
import { user } from "../db/schema";
import { eq } from "drizzle-orm";
import { RISK_COLORS, TRIGGER_LABELS, buildAlertSubject, esc } from "./alertPresentation";
import { sendIndividually } from "./emailDelivery";

let resend: Resend | undefined;

function getResend(): Resend {
  return (resend ??= new Resend(process.env.RESEND_API_KEY));
}

function buildHtml(alerts: Array<{ triggerType: string; riskLevel: string; snippet: string; patientEmail: string }>): string {
  const rows = alerts
    .map((a) => {
      const label = TRIGGER_LABELS[a.triggerType] ?? a.triggerType;
      const color = RISK_COLORS[a.riskLevel] ?? RISK_COLORS["LOW"];
      return `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:${color}">${esc(a.riskLevel)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${esc(label)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb">${esc(a.patientEmail)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-style:italic;color:#6b7280">${esc(a.snippet)}</td>
    </tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<body style="font-family:system-ui,sans-serif;color:#111827;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="margin-bottom:4px">Journey to Recovery — New Alert${alerts.length > 1 ? "s" : ""}</h2>
  <p style="color:#6b7280;margin-top:0">${alerts.length} new alert${alerts.length > 1 ? "s" : ""} require${alerts.length === 1 ? "s" : ""} your review.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">
    <thead>
      <tr style="background:#f9fafb;text-align:left">
        <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb">Risk</th>
        <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb">Type</th>
        <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb">Patient</th>
        <th style="padding:8px 12px;border-bottom:2px solid #e5e7eb">Snippet</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="font-size:12px;color:#9ca3af;margin-top:24px">Log in to review and action these alerts.</p>
</body>
</html>`;
}

// Accepts all alerts from a single chat turn so one email per clinician is
// sent (not one per alert), and the clinician list is queried exactly once.
export async function sendImmediateAlertEmail(
  alerts: Array<{
    triggerType: string;
    riskLevel: string;
    snippet: string;
    patientEmail: string;
  }>,
): Promise<void> {
  if (alerts.length === 0) return;

  const clinicians = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.role, "clinician"));

  let to = clinicians.map((c) => c.email);

  if (to.length === 0) {
    const fallback = process.env.DIGEST_FALLBACK_EMAIL;
    if (fallback) {
      to = [fallback];
      console.warn(`Alert email: no clinician accounts found — falling back to ${fallback}.`);
    } else {
      console.warn("Alert email: no clinician accounts found and DIGEST_FALLBACK_EMAIL is not set — skipping.");
      return;
    }
  }

  if (!process.env.RESEND_FROM) {
    console.warn("Alert email: RESEND_FROM is not set — falling back to alerts@resend.dev, which only delivers to the Resend account owner.");
  }

  const from = process.env.RESEND_FROM ?? "alerts@resend.dev";
  const subject = buildAlertSubject(alerts.map((a) => a.riskLevel));
  const html = buildHtml(alerts);

  // Send individually so no recipient sees another clinician's email address.
  await sendIndividually(
    to,
    (email) => getResend().emails.send({ from, to: [email], subject, html }),
  );
}
