import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import {
  app,
  dbInsertResult,
  startServer,
  stopServer,
  signTestAccessToken,
  authCookie,
  mockAuthOk,
  resetMocks,
} from "./_testUtils";

let server: Awaited<ReturnType<typeof startServer>>["server"];
let baseUrl: string;

beforeAll(async () => {
  const started = await startServer();
  server = started.server;
  baseUrl = started.baseUrl;
});

afterAll(async () => {
  await stopServer(server);
});

afterEach(() => {
  resetMocks();
});

const token = signTestAccessToken({ id: "user-1", email: "test@example.com" });

const VALID_WELLNESS_BODY = {
  wellnessRatings: { social: 5, physical: 6 },
  wellnessExplanations: { social: "ok", physical: "ok" },
  focusArea: "physical",
  strengths: {
    values: "family",
    goodAt: "cooking",
    overcome: "stroke",
    valuedFor: "kindness",
  },
};

describe("POST /api/wellness-summary", () => {
  it("saves the wellness summary and returns 201", async () => {
    mockAuthOk();
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 });

    const res = await fetch(`${baseUrl}/api/wellness-summary`, {
      method: "POST",
      headers: {
        ...authCookie(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(VALID_WELLNESS_BODY),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ message: "Wellness summary saved successfully." });

    expect(dbInsertResult).toHaveBeenCalledTimes(1);
    const [values] = dbInsertResult.mock.calls[0]!;
    expect(values.focusArea).toBe("physical");
    expect(values.socialRating).toBe(5);
    expect(values.userId).toBe("user-1");
    expect(typeof values.id).toBe("string");
  });

  it("returns 400 when focusArea is missing", async () => {
    mockAuthOk();
    const { focusArea, ...rest } = VALID_WELLNESS_BODY;

    const res = await fetch(`${baseUrl}/api/wellness-summary`, {
      method: "POST",
      headers: {
        ...authCookie(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(rest),
    });

    expect(res.status).toBe(400);
    expect(dbInsertResult).not.toHaveBeenCalled();
  });

  it("returns 500 when the insert fails", async () => {
    mockAuthOk();
    dbInsertResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await fetch(`${baseUrl}/api/wellness-summary`, {
      method: "POST",
      headers: {
        ...authCookie(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(VALID_WELLNESS_BODY),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Server error saving summary." });
  });
});
