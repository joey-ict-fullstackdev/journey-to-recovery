import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import {
  app,
  dbSelectWhereResult,
  dbUpdateResult,
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

const VALID_PROFILE_BODY = {
  displayName: "Alex",
  dateOfBirth: "1990-01-01",
  gender: "female",
  meditationExperience: "beginner",
};

describe("GET /api/profile", () => {
  it("returns the user's profile on success", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([
      {
        id: "user-1",
        email: "test@example.com",
        name: "Alex",
        dob: "1990-01-01",
        gender: "female",
        // Snake_case, matching the route's aliased select output — the
        // client destructures userInfo.meditation_level directly.
        meditation_level: "beginner",
      },
    ]);

    const res = await fetch(`${baseUrl}/api/profile`, {
      headers: authCookie(token),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.userInfo.email).toBe("test@example.com");
    expect(body.userInfo.meditation_level).toBe("beginner");
  });

  it("returns 404 when the user row is missing", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockResolvedValueOnce([]);

    const res = await fetch(`${baseUrl}/api/profile`, {
      headers: authCookie(token),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ message: "User not found." });
  });

  it("returns 500 when the query fails", async () => {
    mockAuthOk();
    dbSelectWhereResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await fetch(`${baseUrl}/api/profile`, {
      headers: authCookie(token),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Server error to fetch user info." });
  });

  it("returns 401 with no token", async () => {
    const res = await fetch(`${baseUrl}/api/profile`);
    expect(res.status).toBe(401);
    expect(dbSelectWhereResult).not.toHaveBeenCalled();
  });
});

describe("POST /api/profile", () => {
  it("updates the profile and responds 200 on success", async () => {
    mockAuthOk();
    dbUpdateResult.mockResolvedValueOnce({ affectedRows: 1 });

    const res = await fetch(`${baseUrl}/api/profile`, {
      method: "POST",
      headers: {
        ...authCookie(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(VALID_PROFILE_BODY),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Updated successfully." });

    expect(dbUpdateResult).toHaveBeenCalledTimes(1);
    const [values] = dbUpdateResult.mock.calls[0]!;
    expect(values.name).toBe("Alex");
    expect(values.meditationLevel).toBe("beginner");
  });

  it("returns 400 on invalid body (displayName too short)", async () => {
    mockAuthOk();

    const res = await fetch(`${baseUrl}/api/profile`, {
      method: "POST",
      headers: {
        ...authCookie(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...VALID_PROFILE_BODY, displayName: "Al" }),
    });

    expect(res.status).toBe(400);
    expect(dbUpdateResult).not.toHaveBeenCalled();
  });

  /**
   * Current (buggy) behavior: on a DB error the handler sends a 500 in the
   * catch block WITHOUT returning, then falls through and unconditionally
   * calls res.status(200).json(...) again below it. This pins down which
   * response the client actually observes today, so a future refactor that
   * "accidentally" changes this is caught.
   */
  it("on a DB failure, the client observes the first response sent (500), not the fall-through 200", async () => {
    mockAuthOk();
    dbUpdateResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await fetch(`${baseUrl}/api/profile`, {
      method: "POST",
      headers: {
        ...authCookie(token),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(VALID_PROFILE_BODY),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Server error to update user info." });
  });
});
