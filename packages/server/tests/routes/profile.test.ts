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

const VALID_PROFILE_BODY = {
  displayName: "Alex",
  dateOfBirth: "1990-01-01",
  gender: "female",
  meditationExperience: "beginner",
};

describe("GET /api/profile", () => {
  it("returns the user's profile on success", async () => {
    mockAuthOk();
    fakePool.execute.mockResolvedValueOnce([
      [
        {
          id: "user-1",
          email: "test@example.com",
          name: "Alex",
          dob: "1990-01-01",
          gender: "female",
          meditation_level: "beginner",
        },
      ],
      undefined,
    ]);

    const res = await fetch(`${baseUrl}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.userInfo.email).toBe("test@example.com");
  });

  it("returns 404 when the user row is missing", async () => {
    mockAuthOk();
    fakePool.execute.mockResolvedValueOnce([[], undefined]);

    const res = await fetch(`${baseUrl}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body).toEqual({ message: "User not found." });
  });

  it("returns 500 when the query fails", async () => {
    mockAuthOk();
    fakePool.execute.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await fetch(`${baseUrl}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Server error to fetch user info." });
  });

  it("returns 401 with no token", async () => {
    const res = await fetch(`${baseUrl}/api/profile`);
    expect(res.status).toBe(401);
    expect(fakePool.execute).not.toHaveBeenCalled();
  });
});

describe("POST /api/profile", () => {
  it("updates the profile and responds 200 on success", async () => {
    mockAuthOk();
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    const res = await fetch(`${baseUrl}/api/profile`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(VALID_PROFILE_BODY),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Updated successfully." });

    const [sql, params] = fakePool.execute.mock.calls[1]!;
    expect(sql).toContain("UPDATE user");
    expect((params as any[])[0]).toBe("Alex");
  });

  it("returns 400 on invalid body (displayName too short)", async () => {
    mockAuthOk();

    const res = await fetch(`${baseUrl}/api/profile`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...VALID_PROFILE_BODY, displayName: "Al" }),
    });

    expect(res.status).toBe(400);
    expect(fakePool.execute).toHaveBeenCalledTimes(1); // only the auth blacklist check
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
    fakePool.execute.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await fetch(`${baseUrl}/api/profile`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(VALID_PROFILE_BODY),
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Server error to update user info." });
  });
});
