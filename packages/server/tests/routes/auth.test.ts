import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  app,
  fakePool,
  startServer,
  stopServer,
  signTestAccessToken,
  signTestRefreshToken,
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

const VALID_PASSWORD = "Password1!";

describe("refreshToken cookie attributes (secure/sameSite by NODE_ENV)", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("is not Secure and uses SameSite=Lax outside production", async () => {
    process.env.NODE_ENV = "development";
    fakePool.execute.mockResolvedValueOnce([[], undefined]);
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    const res = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "dev-cookie@example.com",
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      }),
    });
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Secure");
  });

  it("is Secure and uses SameSite=None in production", async () => {
    process.env.NODE_ENV = "production";
    fakePool.execute.mockResolvedValueOnce([[], undefined]);
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    const res = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "prod-cookie@example.com",
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      }),
    });
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Secure");
  });
});

describe("POST /api/signup", () => {
  it("creates a user, returns 201 with an accessToken, and sets a refreshToken cookie", async () => {
    fakePool.execute.mockResolvedValueOnce([[], undefined]); // no existing email
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT user
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT refresh_token

    const res = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "new@example.com",
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(typeof body.accessToken).toBe("string");
    expect(res.headers.get("set-cookie")).toContain("refreshToken=");

    expect(fakePool.execute).toHaveBeenCalledTimes(3);
    const [insertUserSql, insertUserParams] = fakePool.execute.mock.calls[1]!;
    expect(insertUserSql).toContain("INSERT INTO user");

    // The accessToken's payload must match the same id/email just persisted —
    // guards against an id/email swap inside issueTokens().
    const decoded = jwt.decode(body.accessToken) as { id: string; email: string };
    expect(decoded.id).toBe((insertUserParams as any[])[0]);
    expect(decoded.email).toBe("new@example.com");
  });

  it("returns 400 when the email already exists", async () => {
    fakePool.execute.mockResolvedValueOnce([
      [{ email: "dup@example.com" }],
      undefined,
    ]);

    const res = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "dup@example.com",
        password: VALID_PASSWORD,
        confirmPassword: VALID_PASSWORD,
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ message: "Email already exists." });
    expect(fakePool.execute).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when password and confirmPassword don't match", async () => {
    const res = await fetch(`${baseUrl}/api/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "mismatch@example.com",
        password: VALID_PASSWORD,
        confirmPassword: "Different1!",
      }),
    });

    expect(res.status).toBe(400);
    expect(fakePool.execute).not.toHaveBeenCalled();
  });
});

describe("POST /api/login", () => {
  it("returns 200 with an accessToken on correct credentials", async () => {
    const hashed = await bcrypt.hash(VALID_PASSWORD, 10);
    fakePool.execute.mockResolvedValueOnce([
      [{ id: "user-1", email: "a@example.com", password: hashed }],
      undefined,
    ]);
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT refresh_token

    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", password: VALID_PASSWORD }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(typeof body.accessToken).toBe("string");
    expect(res.headers.get("set-cookie")).toContain("refreshToken=");

    const decoded = jwt.decode(body.accessToken) as { id: string; email: string };
    expect(decoded.id).toBe("user-1");
    expect(decoded.email).toBe("a@example.com");
  });

  it("returns 400 when the email does not exist", async () => {
    fakePool.execute.mockResolvedValueOnce([[], undefined]);

    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "missing@example.com",
        password: VALID_PASSWORD,
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ message: "Email does not exist." });
    expect(fakePool.execute).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when the password is wrong", async () => {
    const hashed = await bcrypt.hash(VALID_PASSWORD, 10);
    fakePool.execute.mockResolvedValueOnce([
      [{ id: "user-1", email: "a@example.com", password: hashed }],
      undefined,
    ]);

    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", password: "WrongPass1!" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ message: "Invalid password." });
    expect(fakePool.execute).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when password is missing from the body", async () => {
    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com" }),
    });

    expect(res.status).toBe(400);
    expect(fakePool.execute).not.toHaveBeenCalled();
  });
});

describe("POST /api/refresh-token", () => {
  it("returns 401 with no Cookie header at all", async () => {
    const res = await fetch(`${baseUrl}/api/refresh-token`, { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ message: "Refresh token not provided." });
    expect(fakePool.execute).not.toHaveBeenCalled();
  });

  it("returns 500 when the cookie isn't a validly-signed refresh token", async () => {
    const res = await fetch(`${baseUrl}/api/refresh-token`, {
      method: "POST",
      headers: { Cookie: "refreshToken=not-a-real-jwt" },
    });
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body).toEqual({ message: "Server error during token refresh." });
    expect(fakePool.execute).not.toHaveBeenCalled();
  });

  it("returns 401 when the refresh token is valid but not found in the DB (already used)", async () => {
    const refreshToken = signTestRefreshToken({
      id: "user-1",
      email: "a@example.com",
    });
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]); // DELETE matched nothing

    const res = await fetch(`${baseUrl}/api/refresh-token`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${refreshToken}` },
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ message: "Invalid or already used refresh token." });
    expect(fakePool.execute).toHaveBeenCalledTimes(1);
  });

  it("rotates the refresh token and returns a new accessToken on success", async () => {
    const refreshToken = signTestRefreshToken({
      id: "user-1",
      email: "a@example.com",
    });
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // DELETE old token
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT new refresh_token

    const res = await fetch(`${baseUrl}/api/refresh-token`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${refreshToken}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(typeof body.accessToken).toBe("string");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("refreshToken=");

    const [deleteSql, deleteParams] = fakePool.execute.mock.calls[0]!;
    expect(deleteSql).toContain("DELETE FROM refresh_token");
    expect((deleteParams as any[])[0]).toBe(refreshToken);

    // Both the new access token and the new refresh cookie must carry the
    // same id/email decoded from the old refresh token — guards against an
    // id/email swap inside issueTokens().
    const decodedAccess = jwt.decode(body.accessToken) as {
      id: string;
      email: string;
    };
    expect(decodedAccess.id).toBe("user-1");
    expect(decodedAccess.email).toBe("a@example.com");

    const newRefreshToken = setCookie.match(/refreshToken=([^;]+)/)?.[1];
    const decodedRefresh = jwt.decode(newRefreshToken as string) as {
      id: string;
      email: string;
    };
    expect(decodedRefresh.id).toBe("user-1");
    expect(decodedRefresh.email).toBe("a@example.com");
  });
});

describe("POST /api/logout", () => {
  it("blacklists the access token and returns 200", async () => {
    const token = signTestAccessToken({ id: "user-1", email: "a@example.com" });
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    const res = await fetch(`${baseUrl}/api/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Logged out successfully." });
    expect(fakePool.execute).toHaveBeenCalledTimes(1);
    const [sql] = fakePool.execute.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO blacklisted_token");
  });

  it("returns 200 with no DB calls when no Authorization header is sent", async () => {
    const res = await fetch(`${baseUrl}/api/logout`, { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Logged out successfully." });
    expect(fakePool.execute).not.toHaveBeenCalled();
  });

  it("still returns 200 even when blacklisting the token fails (error is swallowed)", async () => {
    const token = signTestAccessToken({ id: "user-1", email: "a@example.com" });
    fakePool.execute.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await fetch(`${baseUrl}/api/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Logged out successfully." });
  });

  it("also deletes the refresh_token row when a refreshToken cookie is present", async () => {
    const token = signTestAccessToken({ id: "user-1", email: "a@example.com" });
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT blacklisted_token
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // DELETE refresh_token

    await fetch(`${baseUrl}/api/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: "refreshToken=some-real-looking-token",
      },
    });

    expect(fakePool.execute).toHaveBeenCalledTimes(2);
    const [deleteSql, deleteParams] = fakePool.execute.mock.calls[1]!;
    expect(deleteSql).toContain("DELETE FROM refresh_token");
    expect((deleteParams as any[])[0]).toBe("some-real-looking-token");
  });

  it("no longer attempts to delete a refresh_token row when no Cookie is sent", async () => {
    const token = signTestAccessToken({ id: "user-1", email: "a@example.com" });
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // INSERT blacklisted_token only

    await fetch(`${baseUrl}/api/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(fakePool.execute).toHaveBeenCalledTimes(1);
  });
});
