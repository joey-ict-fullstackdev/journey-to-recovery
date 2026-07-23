import { describe, expect, it } from "bun:test";
import {
  RISK_COLORS,
  TRIGGER_LABELS,
  buildAlertSubject,
  esc,
} from "../../utilities/alertPresentation";

describe("alert presentation helpers", () => {
  it("shares labels, colours, and HTML escaping without email-client side effects", () => {
    expect(TRIGGER_LABELS.risk_flag_message).toBe("Safety flag");
    expect(RISK_COLORS.HIGH).toBe("#b91c1c");
    expect(esc("<alert>&")).toBe("&lt;alert&gt;&amp;");
  });

  it("deduplicates risk levels in immediate-alert subjects", () => {
    expect(buildAlertSubject(["HIGH", "HIGH", "MODERATE"])).toBe(
      "[Journey to Recovery] 3 new alerts — HIGH, MODERATE risk",
    );
  });
});
