/**
 * Shared test scaffolding for endpoint tests under tests/routes/.
 *
 * userRoutes.ts constructs `new OpenAI(...)` at import time and reads
 * `connection` from db/connection.ts at import time too, so env vars and
 * module mocks below must be set up BEFORE the router is imported — hence
 * the dynamic `await import(...)` at the bottom instead of a static import.
 *
 * This file's top-level setup runs once (module evaluation is cached), and
 * every test file imports the same `app`/`fakePool` singletons from here —
 * this sidesteps any uncertainty about whether bun:test isolates module
 * registries per test file, since either way each file gets a consistent,
 * already-fully-wired app to test against.
 */
import { mock } from "bun:test";
import express from "express";
import jwt from "jsonwebtoken";
import type { Server } from "http";

process.env.JWT_ACCESS_SECRET = "test-access-secret";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
process.env.OPENAI_API_KEY = "test-openai-key";

// ── Fake DB layer (replaces packages/server/db/connection.ts's default export) ──

export const fakeChatConnection = {
  query: mock(async (_sql: string, _params?: any) => [[], undefined]),
  beginTransaction: mock(async () => {}),
  commit: mock(async () => {}),
  rollback: mock(async () => {}),
  release: mock(() => {}),
};

export const fakePool = {
  execute: mock(async (_sql: string, _params?: any) => [[], undefined]),
  query: mock(async (_sql: string, _params?: any) => [[], undefined]),
  getConnection: mock(async () => fakeChatConnection),
};

await mock.module("../../db/connection", () => ({ default: fakePool }));

// ── Fake AI client (replaces the "openai" package used by userRoutes.ts's
//    module-level `ai` client on the default/non-Gemini code path) ──

export const chatCompletionsCreate = mock(async () => ({
  choices: [{ message: { content: "{}" } }],
}));

class FakeOpenAI {
  chat = { completions: { create: chatCompletionsCreate } };
  constructor(_config: any) {}
}

await mock.module("openai", () => ({ OpenAI: FakeOpenAI }));

// ── Import the router only after env vars + module mocks are in place ──

const { default: userRoutes } = await import("../../routes/userRoutes");

export const app = express();
app.use(express.json());
app.use("/api", userRoutes);
// Deliberately no cookie-parser — packages/server/index.ts never installs it
// either, so req.cookies is always undefined in the real app too. See plan.

export function startServer(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ server, baseUrl: `http://localhost:${port}` });
    });
  });
}

export function stopServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

export function signTestAccessToken(payload: { id: string; email: string }) {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET as string, {
    expiresIn: "1d",
  });
}

/**
 * Every authenticated route hits authenticateToken first, which queries the
 * blacklist table via connection.execute before the route handler's own
 * queries run. Call this before an authenticated request to queue that
 * "not blacklisted" response as the next execute() call.
 */
export function mockAuthOk() {
  fakePool.execute.mockResolvedValueOnce([[], undefined]);
}

export function resetMocks() {
  fakePool.execute.mockClear();
  fakePool.query.mockClear();
  fakePool.getConnection.mockClear();
  fakeChatConnection.query.mockClear();
  fakeChatConnection.beginTransaction.mockClear();
  fakeChatConnection.commit.mockClear();
  fakeChatConnection.rollback.mockClear();
  fakeChatConnection.release.mockClear();
  chatCompletionsCreate.mockClear();
}
