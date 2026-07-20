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
import cookieParser from "cookie-parser";
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

/**
 * Fake for the Drizzle `db` named export, used by code paths that have been
 * migrated off the raw pool (see db/connection.ts). The Step 0 spike found
 * Drizzle's mysql2 driver calls pool.query() with an object-first argument
 * and rowsAsArray:true — not the (sqlString, params) shape fakePool.execute
 * assumes — so mocking at the pool level doesn't work for migrated code.
 * Mocking instead at the query-builder level, one query-chain-shape mock per
 * unique shape as migrations reach it. Only `select().from().where().limit()`
 * exists today (middleware/auth.ts's blacklist check) — extend this object
 * with insert/update/delete/transaction mocks as later routers migrate.
 */
export const dbSelectResult = mock(async (): Promise<any[]> => []);

export const fakeDb = {
  select: mock(() => ({
    from: mock(() => ({
      where: mock(() => ({
        limit: mock(() => dbSelectResult()),
      })),
    })),
  })),
};

await mock.module("../../db/connection", () => ({
  default: fakePool,
  db: fakeDb,
}));

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

// ── Import the routers only after env vars + module mocks are in place ──

const { default: authRoutes } = await import("../../routes/authRoutes");
const { default: profileRoutes } = await import("../../routes/profileRoutes");
const { default: checkinRoutes } = await import("../../routes/checkinRoutes");
const { default: goalRoutes } = await import("../../routes/goalRoutes");
const { default: wellnessRoutes } = await import("../../routes/wellnessRoutes");
const { default: chatRoutes } = await import("../../routes/chatRoutes");

export const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", authRoutes);
app.use("/api", profileRoutes);
app.use("/api", checkinRoutes);
app.use("/api", goalRoutes);
app.use("/api", wellnessRoutes);
app.use("/api", chatRoutes);

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

export function signTestRefreshToken(payload: { id: string; email: string }) {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET as string, {
    expiresIn: "7d",
  });
}

/**
 * Every authenticated route hits authenticateToken first, which queries the
 * blacklist table via the Drizzle `db` (see fakeDb above) before the route
 * handler's own queries run. Call this before an authenticated request to
 * queue an empty result — i.e. "not blacklisted" — as the next db.select(...)
 * resolution. This no longer touches fakePool at all, so it doesn't count
 * against fakePool.execute's call count/index the way it used to.
 */
export function mockAuthOk() {
  dbSelectResult.mockResolvedValueOnce([]);
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
  dbSelectResult.mockClear();
  fakeDb.select.mockClear();
}
