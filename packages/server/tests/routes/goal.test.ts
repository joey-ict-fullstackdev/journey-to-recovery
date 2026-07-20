import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import {
  app,
  fakePool,
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
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

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

    const [sql, params] = fakePool.execute.mock.calls[1]!;
    expect(sql).toContain("INSERT INTO goal");
    const p = params as any[];
    expect(p[3]).toBe("Walk 100m in 4 weeks"); // smartGoal
    expect(p[2]).toBeNull(); // overallGoal omitted -> null
    expect(p[8]).toBe("none"); // reminderType default
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
    expect(fakePool.execute).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the insert fails", async () => {
    mockAuthOk();
    fakePool.execute.mockImplementationOnce(async () => {
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
