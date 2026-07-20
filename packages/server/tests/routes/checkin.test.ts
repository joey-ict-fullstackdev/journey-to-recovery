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

describe("GET /api/check-ins", () => {
  it("returns a 7-day week status array reflecting which days have a check-in", async () => {
    mockAuthOk();
    fakePool.execute.mockImplementationOnce(async (_sql: string, params: any) => {
      const firstWeekDate = params[1];
      return [[{ checkin_date: firstWeekDate }], undefined];
    });

    const res = await fetch(`${baseUrl}/api/check-ins`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.weekStatus)).toBe(true);
    expect(body.weekStatus).toHaveLength(7);
    expect(body.weekStatus[0]).toBe(true);
    expect(body.weekStatus.slice(1).every((v: boolean) => v === false)).toBe(
      true,
    );

    expect(fakePool.execute).toHaveBeenCalledTimes(2);
    const [sql] = fakePool.execute.mock.calls[1]!;
    expect(sql).toContain("FROM daily_checkin");
  });

  it("returns 500 when the DB query fails", async () => {
    mockAuthOk();
    fakePool.execute.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await fetch(`${baseUrl}/api/check-ins`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Server error fetching check-ins." });
  });

  it("returns 401 when no token is provided", async () => {
    const res = await fetch(`${baseUrl}/api/check-ins`);
    expect(res.status).toBe(401);
    expect(fakePool.execute).not.toHaveBeenCalled();
  });
});

describe("POST /api/check-in", () => {
  it("records today's check-in and returns 201", async () => {
    mockAuthOk();
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    const res = await fetch(`${baseUrl}/api/check-in`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "good" }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toEqual({ message: "Check-in successful." });

    const [sql, params] = fakePool.execute.mock.calls[1]!;
    expect(sql).toContain("INSERT INTO daily_checkin");
    expect((params as any[])[3]).toBe("good");
  });

  it("returns 400 when status is missing", async () => {
    mockAuthOk();

    const res = await fetch(`${baseUrl}/api/check-in`, {
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

    const res = await fetch(`${baseUrl}/api/check-in`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "good" }),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Server error during check-in." });
  });
});
