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
import type { Role } from "../../utilities/types";

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
 * Mocking instead at the query-builder level, one mock per query-chain shape
 * as migrations reach it:
 *   - select().from().where().limit(n)  → middleware/auth.ts's blacklist check
 *   - select({...}).from().where()      → checkinRoutes.ts's GET /check-ins,
 *                                          profileRoutes.ts's GET /profile
 *   - insert(table).values({...})       → checkinRoutes.ts's POST /check-in
 *   - update(table).set({...}).where()  → profileRoutes.ts's POST /profile
 *   - delete(table).where()             → authRoutes.ts's /refresh-token, /logout,
 *                                          chatRoutes.ts's DELETE /conversations/:id
 *   - select().from().where().orderBy() → chatRoutes.ts's GET /conversations,
 *                                          GET /conversations/:id (no .limit())
 *   - .orderBy().limit(n)               → chatRoutes.ts's POST /chat history fetch
 *   - transaction(async (tx) => {...})  → chatRoutes.ts's POST /chat
 * The object returned by `.where()` (and `.orderBy()`) is a real "thenable"
 * (has its own `.then()`), not an eagerly-resolved value — this matters
 * because a select chain either gets awaited directly OR has `.limit()`
 * called on it, never both. If `.where()` eagerly called its own resolver,
 * an authenticated request that goes through `.limit()` would silently
 * consume a queued mockResolvedValueOnce meant for a *different*, unrelated
 * select in the same test. Making it lazy (only resolves on whichever path
 * actually gets invoked) avoids that.
 *
 * dbDeleteResult resolves to a [ResultSetHeader, FieldPacket[]] TUPLE, not a
 * plain object like dbInsertResult/dbUpdateResult — confirmed empirically
 * (a Step 6 spike) that real Drizzle's mysql2 dialect returns insert/update/
 * delete results as that raw driver tuple, unwrapped only for selects. This
 * only matters for delete: authRoutes.ts's /refresh-token, /logout, and
 * chatRoutes.ts's DELETE /conversations/:id all destructure and read the
 * result (`[deleteResult]`, checking `.affectedRows`) — insert/update
 * results are never read by any migrated route so far, so those two mocks
 * were left as plain objects rather than churning already-verified steps
 * for a shape nothing consumes.
 *
 * fakeDb.transaction: a Step 7 spike confirmed real Drizzle's mysql2
 * transaction() calls pool.getConnection() and issues begin/commit/rollback
 * as raw SQL through that connection's own .query() — but the callback's
 * `tx` parameter just exposes the same .select/.insert/.update/.delete API
 * as `db` itself (routed through that one pinned connection instead of the
 * pool). None of that internal plumbing needs replicating here — chatRoutes
 * only ever calls documented tx.select()/tx.insert()/etc., so the fake
 * simply invokes the callback with `fakeDb` itself as `tx` (reusing every
 * mock above), and propagates a thrown error as a rejection — exactly the
 * externally-observable contract the spike confirmed, without pretending to
 * simulate real transaction/rollback semantics that don't exist here anyway
 * (nothing in this mock persists real state to roll back).
 */
export const dbSelectLimitResult = mock(async (): Promise<any[]> => []);
export const dbSelectWhereResult = mock(async (): Promise<any[]> => []);
export const dbSelectOrderByResult = mock(async (): Promise<any[]> => []);
export const dbInsertResult = mock(async (_values: any): Promise<any> => ({}));
export const dbUpdateResult = mock(async (_values: any): Promise<any> => ({}));
export const dbDeleteResult = mock(
  async (): Promise<[{ affectedRows: number }, undefined]> => [
    { affectedRows: 0 },
    undefined,
  ],
);
export const dbTransactionCommit = mock(() => {});
export const dbTransactionRollback = mock(() => {});

function makeOrderByChain() {
  return {
    limit: mock(() => dbSelectLimitResult()),
    then(onFulfilled: any, onRejected: any) {
      return dbSelectOrderByResult().then(onFulfilled, onRejected);
    },
  };
}

function makeWhereChain() {
  return {
    limit: mock(() => dbSelectLimitResult()),
    orderBy: mock((_order: any) => makeOrderByChain()),
    then(onFulfilled: any, onRejected: any) {
      return dbSelectWhereResult().then(onFulfilled, onRejected);
    },
  };
}

export const fakeDb: any = {
  select: mock((_fields?: any) => ({
    from: mock((_table: any) => ({
      innerJoin: mock((_joinTable: any, _cond: any) => ({
        leftJoin: mock((_joinTable: any, _cond: any) => ({
          where: mock((_cond: any) => makeWhereChain()),
        })),
        where: mock((_cond: any) => makeWhereChain()),
      })),
      where: mock((_cond: any) => makeWhereChain()),
    })),
  })),
  insert: mock((_table: any) => ({
    values: mock((values: any) => dbInsertResult(values)),
  })),
  update: mock((_table: any) => ({
    set: mock((values: any) => ({
      where: mock((_cond: any) => dbUpdateResult(values)),
    })),
  })),
  delete: mock((_table: any) => ({
    where: mock((_cond: any) => dbDeleteResult()),
  })),
  transaction: mock(async (callback: (tx: any) => Promise<any>) => {
    try {
      const result = await callback(fakeDb);
      dbTransactionCommit();
      return result;
    } catch (err) {
      dbTransactionRollback();
      throw err;
    }
  }),
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

export const moderationsCreate = mock(async () => ({
  results: [{ flagged: false }],
}));

class FakeOpenAI {
  chat = { completions: { create: chatCompletionsCreate } };
  moderations = { create: moderationsCreate };
  constructor(_config: any) {}
}

await mock.module("openai", () => ({ OpenAI: FakeOpenAI }));

// ── Fake alertEmail (replaces utilities/alertEmail used by chatRoutes.ts) ──
// Mocked so fire-and-forget calls don't hit fakeDb.select for clinicians in
// an untracked microtask after tests complete, which would consume
// dbSelectWhereResult slots queued for subsequent tests.
export const sendImmediateAlertEmailMock = mock(async (_alerts: any[]) => {});
await mock.module("../../utilities/alertEmail", () => ({
  sendImmediateAlertEmail: sendImmediateAlertEmailMock,
}));

// ── Import the routers only after env vars + module mocks are in place ──

const { default: authRoutes } = await import("../../routes/authRoutes");
const { default: profileRoutes } = await import("../../routes/profileRoutes");
const { default: checkinRoutes } = await import("../../routes/checkinRoutes");
const { default: goalRoutes } = await import("../../routes/goalRoutes");
const { default: wellnessRoutes } = await import("../../routes/wellnessRoutes");
const { default: chatRoutes } = await import("../../routes/chatRoutes");
const { default: alertRoutes } = await import("../../routes/alertRoutes");

export const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api", authRoutes);
app.use("/api", profileRoutes);
app.use("/api", checkinRoutes);
app.use("/api", goalRoutes);
app.use("/api", wellnessRoutes);
app.use("/api", chatRoutes);
app.use("/api", alertRoutes);

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

type TestTokenPayload = { id: string; email: string; role?: Role };

function signToken(payload: TestTokenPayload, secret: string, expiresIn: string) {
  return jwt.sign({ role: "patient", ...payload }, secret, { expiresIn });
}

export function signTestAccessToken(payload: TestTokenPayload) {
  return signToken(payload, process.env.JWT_ACCESS_SECRET as string, "1d");
}

export function signTestRefreshToken(payload: TestTokenPayload) {
  return signToken(payload, process.env.JWT_REFRESH_SECRET as string, "7d");
}

// authenticateToken now reads the access token from a cookie, not the
// Authorization header — build the request headers for an authenticated
// fetch() call with this instead of a manual header string.
export function authCookie(token: string) {
  return { Cookie: `accessToken=${token}` };
}

// Extracts and decodes the accessToken cookie from a Set-Cookie header value
// (e.g. res.headers.get("set-cookie")) — the token no longer round-trips
// through the JSON response body, so tests that need to inspect its payload
// (id/email) must pull it out of the cookie instead.
export function decodeAccessTokenCookie(
  setCookie: string,
): { id: string; email: string; role: Role } {
  const token = setCookie.match(/accessToken=([^;]+)/)?.[1];
  return jwt.decode(token as string) as { id: string; email: string; role: Role };
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
  dbSelectLimitResult.mockResolvedValueOnce([]);
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
  moderationsCreate.mockClear();
  dbSelectLimitResult.mockClear();
  dbSelectWhereResult.mockClear();
  dbSelectOrderByResult.mockClear();
  dbInsertResult.mockClear();
  dbUpdateResult.mockClear();
  dbDeleteResult.mockClear();
  dbTransactionCommit.mockClear();
  dbTransactionRollback.mockClear();
  fakeDb.select.mockClear();
  fakeDb.insert.mockClear();
  fakeDb.update.mockClear();
  fakeDb.delete.mockClear();
  fakeDb.transaction.mockClear();
}
