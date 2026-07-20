# Handoff: server route refactor + Drizzle ORM migration + local DB schema sync

Context for whoever picks this up: `packages/server/routes/userRoutes.ts` was originally a 689-line file holding all 14 API endpoints, talking to MySQL via raw `mysql2` SQL strings. Across this multi-session effort it was (1) covered with a test safety net, (2) split into 6 domain-focused router files, (3) had its auth/cookie bugs fixed, and (4) fully migrated off raw SQL onto Drizzle ORM, one router at a time. Along the way, this local dev machine's actual MySQL database turned out to have drifted significantly from the project's schema file — that's now fixed too. `userRoutes.ts` no longer exists; raw SQL no longer exists anywhere in `routes/`.

## Done

Everything below is implemented and — per `git log` — committed, except the two files listed at the end of this section.

**Route split + auth fixes** (earliest part of this effort):
1. `userRoutes.ts` split into `routes/authRoutes.ts`, `profileRoutes.ts`, `checkinRoutes.ts`, `goalRoutes.ts`, `wellnessRoutes.ts`, `chatRoutes.ts`, each mounted independently in `index.ts`.
2. `issueTokens()` helper added to `authRoutes.ts`, deduping a repeated JWT-sign/insert/cookie block.
3. Two real pre-existing bugs fixed: `cookie-parser` was never installed/wired (so `/refresh-token` always 401'd and `/logout` never deleted its refresh-token row), and the refresh cookie had `secure`/`sameSite` hardcoded wrong for cross-origin (Netlify↔Railway) use in production.
4. `accessToken`/`newAccessToken` response-key inconsistency unified to `accessToken` everywhere (server + client's Axios interceptor).
5. `tests/routes/` built (52 tests across 6 files) — mocked DB pool + AI SDK via `bun:test`'s `mock.module`, one shared Express app across all test files. This suite is what made every later step below verifiable as behavior-preserving.

**Drizzle ORM migration** (this session, the bulk of the work):
6. `drizzle-orm` + `drizzle-kit` added as dependencies. `packages/server/db/schema.ts` created — all 9 tables (`user`, `refreshToken`, `blacklistedToken`, `dailyCheckin`, `goal`, `wellnessWheel`, `conversations`, `messages`, `chatGoals`) as `mysqlTable` definitions, matching `db/migration.sql` column-for-column.
7. `db/connection.ts` now exports both `db` (the Drizzle instance, wrapping the pool) and the raw pool as `default`. Every route file was migrated from raw `connection.execute(...)`/`.query(...)` calls to `db.select()/.insert()/.update()/.delete()/.transaction()`, one router at a time (checkin → goal → wellness → profile → auth → chat), each step verified against the test suite + a live server boot before moving to the next.
8. `tests/routes/_testUtils.ts`'s mocking layer was rebuilt for this — see Gotchas below, this is not obvious from reading the test files alone.
9. One real bug caught and fixed *during* the migration, not pre-existing: `profileRoutes.ts`'s `GET /profile` and `chatRoutes.ts`'s `GET /conversations` would have silently changed their JSON response shape from snake_case (`meditation_level`, `updated_at`) to Drizzle's default camelCase, breaking client code that reads those exact keys — caught before shipping by checking the client source first, fixed via explicit field aliasing in the `.select()` calls.

**Local DB schema sync** (most recent, triggered by a real signup failure):
10. This machine's actual local MySQL database (`my-chatbot-schema`) had drifted substantially from `db/migration.sql` — wrong column types/lengths, a missing `user.created_at` column (the original symptom), FKs missing `ON DELETE CASCADE`, an unintended `UNIQUE` constraint on `user.password`, etc. Diagnosed by reading a full `mysqldump` of all 9 tables (provided by the user) and diffing against `migration.sql`.
11. `db/migration.sql`'s Section 2 was extended with a "Sync" block bringing an existing DB in line with Section 1 exactly. This was actually run against the local database (tables were confirmed empty first via real `COUNT(*)`, removing all data-safety risk) using `mysql.exe` directly (found under `Program Files\MySQL\MySQL Server 9.4\bin\`, credentials from `packages/server/.env`).
12. End-to-end verified: booted the server against the real `.env`/DB, called `POST /api/signup` for real, got a real `201` with a real JWT and a correctly-persisted `user` row, confirmed `ON DELETE CASCADE` works by deleting the test user and watching its `refresh_token` row cascade-delete. Test row cleaned up afterward.

**Uncommitted right now** (per `git status`):
- `CLAUDE.md` — updated with this session's architecture changes and gotchas.
- `packages/server/db/migration.sql` — the corrected, verified-working Sync block (see Gotchas — the first version I wrote had two real bugs, both now fixed in the file).

Current state: `bun test tests/routes` → **52 pass, 0 fail**. `bun test` (full suite, including `tests/evaluation/`) is currently unreliable — see next section.

## In flight / open

Two things, neither started:

1. **`tests/evaluation/` (the LLM eval suite) is no longer self-skipping, and is failing.** It used to skip itself whenever `OPENAI_API_KEY` was absent. A `.env` now exists locally (created by the user partway through this session, for the DB work) with a real-looking `OPENAI_API_KEY` — so the eval suite now actually runs, and a background `bun test` run took **~10 minutes instead of the usual ~2 seconds**, with **12 failures**. Not diagnosed at all — could be an invalid/expired key, rate limiting, a real regression, or something else entirely. Until this is looked into, use `bun test tests/routes` (2s, 52/52 reliable) instead of bare `bun test`.
2. **`POST /chat`'s Gemini branch (`EVAL_MODEL=gemini-2.5-flash`) has zero test coverage**, pre-dating and surviving the Drizzle migration unchanged. `chatRoutes.ts` picks its AI client (OpenAI vs Gemini) once at module-import time, and `tests/routes/_testUtils.ts` is a deliberately shared singleton (one Express app, imported once, reused by every test file) — re-importing `chatRoutes.ts` mid-suite with a different `EVAL_MODEL` to hit the Gemini branch would fight that design. No decision made yet on whether to fix this (separate test process? factory-style AI client instead of a module-level singleton? accept the gap?).

## Exact next step

No task is currently queued by the user. The most recent turns were housekeeping (`CLAUDE.md` update, this handoff). If continuing this thread:
- **Higher priority:** investigate the eval-suite failures (item 1 above) — 12 failures and a 10-minute runtime is a real regression signal, not just a coverage gap, and it's new as of this session.
- **Lower priority / pre-existing:** the Gemini test-coverage gap (item 2 above).
- Otherwise: commit the two pending files (`CLAUDE.md`, `db/migration.sql`) and confirm with the user what's next.

## Gotchas hit this session

**Drizzle / mocking:**
- Drizzle's `mysql2` dialect does **not** call the pool's `.execute(sqlString, params)` the way the old raw-SQL tests assumed — it calls `.query({ sql, rowsAsArray: true, typeCast }, params)` (an object-first argument, positional-array row data). Confirmed by writing throwaway spike tests against a real `drizzle()` instance before touching any route code — this is why `tests/routes/_testUtils.ts`'s `fakeDb` mocks the *query-builder chain* (`select`/`insert`/`update`/`delete`/`transaction`, each with its own resolvable mock like `dbSelectWhereResult`/`dbInsertResult`), not the raw pool. `fakePool.execute`/`.query` are dead for any Drizzle-touched code path.
- The mock chain for `.where()` is a real **thenable** (has its own `.then()`), not an eagerly-resolved value — necessary because a select either gets awaited directly or has `.limit()`/`.orderBy()` chained onto it, never both, and an eager resolver would let one path silently consume a mock value meant for the other.
- `db.transaction(async (tx) => {...})` in real Drizzle calls `pool.getConnection()` and issues `begin`/`commit`/`rollback` as raw SQL through that connection's `.query()` — confirmed via another spike. None of that needed replicating in the mock: `tx` only ever needs `.select`/`.insert`/`.update`/`.delete`, so `fakeDb.transaction` just invokes its callback with `fakeDb` itself as `tx`.
- `insert`/`update`/`delete` all resolve to a `[ResultSetHeader, FieldPacket[]]` **tuple** in real Drizzle, not an unwrapped object — confirmed via spike. Only matters where the result is actually read (`authRoutes.ts`'s `/refresh-token`, `chatRoutes.ts`'s `DELETE /conversations/:id`, both check `.affectedRows`); left the insert/update mocks as plain objects since nothing reads those.
- **Client wire-format trap:** Drizzle's default `.select()` (no explicit fields object) returns camelCase keys matching the TS schema property names, not the original snake_case DB column names. Two responses in this codebase are sent to the client largely unprocessed and the client destructures specific snake_case keys directly (`user.meditation_level` in `ProfileForm.tsx`, `conv.updated_at` in `ChatSidebar.tsx`) — letting Drizzle's default camelCase leak into either response would have silently broken the client. Always grep the client source for the exact field names before trusting an ORM's default key casing on any user-facing select.
- Schema files sometimes need import aliasing: `db/schema.ts`'s `user` and `refreshToken` tables collide with extremely common local variable names in route handlers (`const user = (req as any).user`, `const refreshToken = jwt.sign(...)`). Convention used: alias the import (`import { user as userTable } from "../db/schema"`), never rename the local variable.

**MySQL (this local install, version 9.4.0 specifically):**
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` throws `ERROR 1064` on this server, despite being documented as supported since MySQL 8.0.29. Confirmed by testing multiple syntax variants directly against the live DB. A pre-existing line in `migration.sql` using this syntax had apparently never actually been run against this server before — it was broken and nobody had noticed. Don't trust this syntax without testing against the actual target server first.
- MySQL refuses to `MODIFY` a column that's an active foreign-key target. Resizing `user.id`/`conversations.id` required a three-phase script: drop every FK referencing them → do all column changes → re-add every FK (with `ON DELETE CASCADE`). Discovered by hitting `ERROR 1833` mid-run on the first attempt.
- MySQL's `source` client command mangles Windows paths (`C:\Users\...` — backslashes get interpreted as escape sequences, e.g. `\U` breaks). Use shell input redirection (`mysql.exe ... < file.sql`) instead of `source file.sql`.
- On Windows, piping a large multi-statement SQL blob into `mysql.exe` via PowerShell (`Get-Content -Raw | & mysql.exe ...`) silently executed **nothing** with no clear error — switching to `cmd /c` with `<` input redirection worked reliably. If a piped mysql command "succeeds" (or fails ambiguously) but the schema doesn't change, verify with a direct `SHOW CREATE TABLE` query rather than trusting the exit code.

**Carried over from earlier sessions, still true:**
- `bun:test` mock rejections: use `.mockImplementationOnce(async () => { throw ... })`, not `.mockRejectedValueOnce(...)` — the latter constructs the rejected promise eagerly at queue time, which can trip `bun:test`'s unhandled-rejection detector as a false failure before the code under test ever awaits it.
- `db/connection.ts`'s production branch parses its MySQL URL eagerly at import time — booting locally with `NODE_ENV=production` crashes unless the Railway env vars are at least syntactically valid, even as dummy values.
- All 6 routers mount at the same `/api` prefix, in a fixed order, in both `index.ts` and `_testUtils.ts` — nothing prevents a path collision between them (earlier-mounted wins silently). Check by hand when adding routes.
- `_testUtils.ts` must be kept in sync with `index.ts` by hand whenever a router changes. Forgetting the test side 404s loudly (easy to catch); forgetting the real side is a silent, uncaught production gap.
- PowerShell + native executables: avoid `2>&1` — it can wrap successful-but-noisy output in a `NativeCommandError` that looks like failure. Redirect to a file (`bun test *> out.log`) or check `$LASTEXITCODE` instead.
- Commits happen outside this assistant's direct actions in this project — `git commit` is never run unless explicitly asked, yet `git log` shows commits landing between turns (apparently the user commits manually). Always check `git status`/`git log` directly; don't assume the working tree state from conversation history.

## Useful verification commands

```bash
cd packages/server
bun test tests/routes       # endpoint tests only — reliable, ~2s, expect 52 pass / 0 fail
bun test                    # full suite INCLUDING the currently-broken eval suite — see "In flight" above
cd ../client
bun run build                # sanity check, unaffected by server-only changes
```

To inspect the local MySQL DB directly (client isn't on `PATH`):
```powershell
& "C:\Program Files\MySQL\MySQL Server 9.4\bin\mysql.exe" -u root -p123456 my-chatbot-schema -e "SHOW CREATE TABLE user;"
```
(Prefer a `--defaults-extra-file` temp option file over `-p<password>` inline to avoid the password appearing in process listings — see how `db/migration.sql`'s Sync block was applied this session for the pattern, though that temp file was deleted after use and isn't committed anywhere.)
