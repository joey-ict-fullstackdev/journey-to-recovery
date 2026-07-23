import { describe, expect, it } from "bun:test";
import { sendIndividually } from "../../utilities/emailDelivery";

describe("sendIndividually", () => {
  it("attempts every recipient before reporting aggregate failures", async () => {
    const attempted: string[] = [];

    await expect(
      sendIndividually(["first@example.test", "second@example.test", "third@example.test"], async (email) => {
        attempted.push(email);
        if (email === "first@example.test") throw new Error("network down");
        if (email === "second@example.test") return { error: { message: "provider rejected" } };
        return { data: { id: "sent" } };
      }),
    ).rejects.toThrow("Email delivery failed for 2 recipient(s)");

    expect(attempted).toEqual([
      "first@example.test",
      "second@example.test",
      "third@example.test",
    ]);
  });
});
