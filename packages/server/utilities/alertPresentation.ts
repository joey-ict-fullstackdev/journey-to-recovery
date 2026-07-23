export const TRIGGER_LABELS: Record<string, string> = {
  high_risk_goal: "High-risk goal",
  risk_flag_message: "Safety flag",
};

export const RISK_COLORS: Record<string, string> = {
  HIGH: "#b91c1c",
  MODERATE: "#92400e",
  LOW: "#374151",
};

export function esc(s: string | null | undefined): string {
  if (!s) return "—";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildAlertSubject(riskLevels: readonly string[]): string {
  const uniqueRiskLevels = [...new Set(riskLevels)];
  const count = riskLevels.length;
  return `[Journey to Recovery] ${count} new alert${count === 1 ? "" : "s"} — ${uniqueRiskLevels.join(", ")} risk`;
}
