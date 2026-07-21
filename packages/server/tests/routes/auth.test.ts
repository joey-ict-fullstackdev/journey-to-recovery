import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  app,
  dbSelectWhereResult,
  dbInsertResult,
  dbDeleteResult,
  startServer,
  stopServer,
  signTestAccessToken,
  signTestRefreshToken,
  authCookie,
  decodeAccessTokenCookie,
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

describe("auth cookie attributes (secure/sameSite by NODE_ENV)", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("is not Secure and uses SameSite=Lax outside production", async () => {
    process.env.NODE_ENV = "development";
    dbSelectWhereResult.mockResolvedValueOnce([]); // no existing email
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT user
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT refresh_token

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

    expect(setCookie).toContain("accessToken=");
    expect(setCookie).toContain("refreshToken=");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).not.toContain("Secure");
  });

  it("is Secure and uses SameSite=None in production", async () => {
    process.env.NODE_ENV = "production";
    dbSelectWhereResult.mockResolvedValueOnce([]);
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 });
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 });

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

    expect(setCookie).toContain("accessToken=");
    expect(setCookie).toContain("refreshToken=");
    expect(setCookie).toContain("SameSite=None");
    expect(setCookie).toContain("Secure");
  });
});

describe("POST /api/signup", () => {
  it("creates a user, returns 201, and sets accessToken + refreshToken cookies", async () => {
    dbSelectWhereResult.mockResolvedValueOnce([]); // no existing email
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT user
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT refresh_token

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
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(res.status).toBe(201);
    expect(body).toEqual({ message: "Signup successful." });
    expect(setCookie).toContain("accessToken=");
    expect(setCookie).toContain("refreshToken=");

    expect(dbSelectWhereResult).toHaveBeenCalledTimes(1);
    expect(dbInsertResult).toHaveBeenCalledTimes(2);
    const [insertUserValues] = dbInsertResult.mock.calls[0]!;
    expect(insertUserValues.email).toBe("new@example.com");
    expect(typeof insertUserValues.id).toBe("string");

    // The accessToken cookie's payload must match the same id/email just
    // persisted — guards against an id/email swap inside issueTokens().
    const decoded = decodeAccessTokenCookie(setCookie);
    expect(decoded.id).toBe(insertUserValues.id);
    expect(decoded.email).toBe("new@example.com");
  });

  it("returns 400 when the email already exists", async () => {
    dbSelectWhereResult.mockResolvedValueOnce([{ email: "dup@example.com" }]);

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
    expect(dbInsertResult).not.toHaveBeenCalled();
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
    expect(dbSelectWhereResult).not.toHaveBeenCalled();
    expect(dbInsertResult).not.toHaveBeenCalled();
  });
});

describe("POST /api/login", () => {
  it("returns 200 and sets accessToken + refreshToken cookies on correct credentials", async () => {
    const hashed = await bcrypt.hash(VALID_PASSWORD, 10);
    dbSelectWhereResult.mockResolvedValueOnce([
      { id: "user-1", email: "a@example.com", password: hashed },
    ]);
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT refresh_token

    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", password: VALID_PASSWORD }),
    });
    const body = await res.json();
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Login successful." });
    expect(setCookie).toContain("accessToken=");
    expect(setCookie).toContain("refreshToken=");

    const decoded = decodeAccessTokenCookie(setCookie);
    expect(decoded.id).toBe("user-1");
    expect(decoded.email).toBe("a@example.com");
  });

  it("returns 400 when the email does not exist", async () => {
    dbSelectWhereResult.mockResolvedValueOnce([]);

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
    expect(dbSelectWhereResult).toHaveBeenCalledTimes(1);
  });

  it("returns 400 when the password is wrong", async () => {
    const hashed = await bcrypt.hash(VALID_PASSWORD, 10);
    dbSelectWhereResult.mockResolvedValueOnce([
      { id: "user-1", email: "a@example.com", password: hashed },
    ]);

    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", password: "WrongPass1!" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toEqual({ message: "Invalid password." });
    expect(dbInsertResult).not.toHaveBeenCalled();
  });

  it("returns 400 when password is missing from the body", async () => {
    const res = await fetch(`${baseUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com" }),
    });

    expect(res.status).toBe(400);
    expect(dbSelectWhereResult).not.toHaveBeenCalled();
  });
});

describe("POST /api/refresh-token", () => {
  it("returns 401 with no Cookie header at all", async () => {
    const res = await fetch(`${baseUrl}/api/refresh-token`, { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ message: "Refresh token not provided." });
    expect(dbDeleteResult).not.toHaveBeenCalled();
  });

  it("returns 401 when the cookie isn't a validly-signed refresh token", async () => {
    const res = await fetch(`${baseUrl}/api/refresh-token`, {
      method: "POST",
      headers: { Cookie: "refreshToken=not-a-real-jwt" },
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ message: "Invalid or expired refresh token." });
    expect(dbDeleteResult).not.toHaveBeenCalled();
  });

  it("returns 401 when the refresh token is valid but not found in the DB (already used)", async () => {
    const refreshToken = signTestRefreshToken({
      id: "user-1",
      email: "a@example.com",
    });
    dbDeleteResult.mockResolvedValueOnce([{ affectedRows: 0 }, undefined]); // DELETE matched nothing

    const res = await fetch(`${baseUrl}/api/refresh-token`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${refreshToken}` },
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ message: "Invalid or already used refresh token." });
    expect(dbDeleteResult).toHaveBeenCalledTimes(1);
  });

  it("rotates both cookies and returns 200 on success", async () => {
    const refreshToken = signTestRefreshToken({
      id: "user-1",
      email: "a@example.com",
    });
    dbDeleteResult.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // DELETE old token
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT new refresh_token

    const res = await fetch(`${baseUrl}/api/refresh-token`, {
      method: "POST",
      headers: { Cookie: `refreshToken=${refreshToken}` },
    });
    const body = await res.json();
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Token refreshed." });
    expect(setCookie).toContain("accessToken=");
    expect(setCookie).toContain("refreshToken=");
    expect(dbDeleteResult).toHaveBeenCalledTimes(1);
    expect(dbInsertResult).toHaveBeenCalledTimes(1);

    // Both the new access token and the new refresh cookie must carry the
    // same id/email decoded from the old refresh token — guards against an
    // id/email swap inside issueTokens().
    const decodedAccess = decodeAccessTokenCookie(setCookie);
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
  it("blacklists the access token, clears both cookies, and returns 200", async () => {
    const token = signTestAccessToken({ id: "user-1", email: "a@example.com" });
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 });

    const res = await fetch(`${baseUrl}/api/logout`, {
      method: "POST",
      headers: authCookie(token),
    });
    const body = await res.json();
    const setCookie = res.headers.get("set-cookie") ?? "";

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Logged out successfully." });
    expect(dbInsertResult).toHaveBeenCalledTimes(1);
    const [values] = dbInsertResult.mock.calls[0]!;
    expect(values.token).toBe(token);
    expect(setCookie).toContain("accessToken=;");
    expect(setCookie).toContain("refreshToken=;");
  });

  it("returns 200 with no DB calls when no Cookie is sent", async () => {
    const res = await fetch(`${baseUrl}/api/logout`, { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Logged out successfully." });
    expect(dbInsertResult).not.toHaveBeenCalled();
  });

  it("still returns 200 even when blacklisting the token fails (error is swallowed)", async () => {
    const token = signTestAccessToken({ id: "user-1", email: "a@example.com" });
    dbInsertResult.mockImplementationOnce(async () => {
      throw new Error("boom");
    });

    const res = await fetch(`${baseUrl}/api/logout`, {
      method: "POST",
      headers: authCookie(token),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ message: "Logged out successfully." });
  });

  it("also deletes the refresh_token row when a refreshToken cookie is present", async () => {
    const token = signTestAccessToken({ id: "user-1", email: "a@example.com" });
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT blacklisted_token
    dbDeleteResult.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]); // DELETE refresh_token

    await fetch(`${baseUrl}/api/logout`, {
      method: "POST",
      headers: {
        Cookie: `accessToken=${token}; refreshToken=some-real-looking-token`,
      },
    });

    expect(dbInsertResult).toHaveBeenCalledTimes(1);
    expect(dbDeleteResult).toHaveBeenCalledTimes(1);
  });

  it("no longer attempts to delete a refresh_token row when no refreshToken cookie is sent", async () => {
    const token = signTestAccessToken({ id: "user-1", email: "a@example.com" });
    dbInsertResult.mockResolvedValueOnce({ affectedRows: 1 }); // INSERT blacklisted_token only

    await fetch(`${baseUrl}/api/logout`, {
      method: "POST",
      headers: authCookie(token),
    });

    expect(dbInsertResult).toHaveBeenCalledTimes(1);
    expect(dbDeleteResult).not.toHaveBeenCalled();
  });
});
