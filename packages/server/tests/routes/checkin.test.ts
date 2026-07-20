import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import {
  app,
  fakeDb,
  dbSelectWhereResult,
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

describe("GET /api/check-ins", () => {
  it("returns a 7-day week status array reflecting which days have a check-in", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockImplementationOnce(async () => {
      // Mimic today already being checked in — the route always includes
      // "today" in weekDates, so echoing today's own date back as a row is
      // a self-contained way to assert on the mapping without duplicating
      // the route's own day-of-week math here.
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      return [{ checkinDate: `${yyyy}-${mm}-${dd}` }];
    });

    const res = await fetch(`${baseUrl}/api/check-ins`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.weekStatus)).toBe(true);
    expect(body.weekStatus).toHaveLength(7);
    expect(body.weekStatus.filter((v: boolean) => v === true)).toHaveLength(1);

    expect(dbSelectWhereResult).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when the DB query fails", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockImplementationOnce(async () => {
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
    expect(fakeDb.select).not.toHaveBeenCalled();
  });
});

describe("POST /api/check-in", () => {
  it("records today's check-in and returns 201", async () => {
    mockAuthOk();
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 });

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

    expect(dbInsertResult).toHaveBeenCalledTimes(1);
    const [values] = dbInsertResult.mock.calls[0]!;
    expect(values.status).toBe("good");
    expect(values.userId).toBe("user-1");
    expect(typeof values.id).toBe("string");
    expect(typeof values.checkinDate).toBe("string");
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
    expect(dbInsertResult).not.toHaveBeenCalled();
  });

  it("returns 500 when the insert fails", async () => {
    mockAuthOk();
    dbInsertResult.mockImplementationOnce(async () => {
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
