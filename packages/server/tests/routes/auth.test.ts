import { describe, it, expect, beforeAll, afterAll, afterEach } from "bun:test";
import bcrypt from "bcryptjs";
import {
  app,
  fakePool,
  startServer,
  stopServer,
  signTestAccessToken,
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
    const [insertUserSql] = fakePool.execute.mock.calls[1]!;
    expect(insertUserSql).toContain("INSERT INTO user");
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
  it("always returns 401 regardless of the Cookie header sent (cookie-parser is never wired up in index.ts, so req.cookies is always undefined)", async () => {
    const res = await fetch(`${baseUrl}/api/refresh-token`, {
      method: "POST",
      headers: { Cookie: "refreshToken=some-real-looking-token" },
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toEqual({ message: "Refresh token not provided." });
    expect(fakePool.execute).not.toHaveBeenCalled();
  });

  it("returns 401 with no Cookie header at all", async () => {
    const res = await fetch(`${baseUrl}/api/refresh-token`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(fakePool.execute).not.toHaveBeenCalled();
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

  it("never attempts to delete a refresh_token row, since req.cookies is always undefined", async () => {
    const token = signTestAccessToken({ id: "user-1", email: "a@example.com" });
    fakePool.execute.mockResolvedValueOnce([{ affectedRows: 1 }, undefined]);

    await fetch(`${baseUrl}/api/logout`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Cookie: "refreshToken=some-real-looking-token",
      },
    });

    expect(fakePool.execute).toHaveBeenCalledTimes(1);
    const [sql] = fakePool.execute.mock.calls[0]!;
    expect(sql).not.toContain("DELETE FROM refresh_token");
  });
});
