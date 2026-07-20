import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import {
  app,
  dbInsertResult,
  startServer,
  stopServer,
  signTestAccessToken,
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

describe("POST /api/goal", () => {
  it("saves a goal with only the required field and returns 201", async () => {
    mockAuthOk();
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 });

    const res = await fetch(`${baseUrl}/api/goal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ smartGoal: "Walk 100m in 4 weeks" }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ message: "Goal saved successfully." });

    expect(dbInsertResult).toHaveBeenCalledTimes(1);
    const [values] = dbInsertResult.mock.calls[0]!;
    expect(values.smartGoal).toBe("Walk 100m in 4 weeks");
    expect(values.overallGoal).toBeNull();
    expect(values.reminderType).toBe("none");
    expect(values.userId).toBe("user-1");
    expect(typeof values.id).toBe("string");
  });

  it("returns 400 when smartGoal is missing", async () => {
    mockAuthOk();

    const res = await fetch(`${baseUrl}/api/goal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    expect(dbInsertResult).not.toHaveBeenCalled();
  });

  it("returns 500 when the insert fails", async () => {
    mockAuthOk();
    dbInsertResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await fetch(`${baseUrl}/api/goal`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ smartGoal: "Walk 100m in 4 weeks" }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Server error saving goal." });
  });

  it("returns 401 with no token", async () => {
    const res = await fetch(`${baseUrl}/api/goal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ smartGoal: "x" }),
    });
    expect(res.status).toBe(401);
  });
});
