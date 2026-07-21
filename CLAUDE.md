# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Journey to Recovery is a stroke rehabilitation web application featuring SMART goal setting, daily wellness tracking, a multi-dimensional wellness wheel assessment, and an AI-powered chatbot ("Camay") that co-authors SMART goals with the user.

## Commands

```bash
# Install all dependencies (root + workspaces)
bun install

# Run both client and server concurrently (from root)
bun run dev

# Client only
cd packages/client && bun run dev      # Vite dev server (port 5173)
cd packages/client && bun run build    # TypeScript check + Vite production build
cd packages/client && bun run lint     # ESLint

# Server only
cd packages/server && bun run dev      # Express with --watch auto-reload (port 3000)
cd packages/server && bun run start    # Production server
```

### Tests (`packages/server`)

Two independent suites, both picked up by `bun test`:

- **`tests/routes/`** — HTTP-level tests for all 6 routers (auth, profile, check-in, goal, wellness, chat/conversations). The DB pool and the AI SDK are mocked via `bun:test`'s `mock.module` (see `tests/routes/_testUtils.ts`, which builds one real Express app shared by every test file) — no real MySQL or API keys needed, runs in ~1-2s. Covers the `/chat` endpoint's default OpenAI code path only; the `EVAL_MODEL=gemini-2.5-flash` branch isn't covered by this suite (the AI client is bound once at import time, which doesn't fit the shared-app test design).
- **`tests/evaluation/`** — an LLM-driven eval harness for the chatbot (scenarios in `scenarios.ts`, simulator in `ChatSimulator.ts`). Needs `OPENAI_API_KEY` in `.env`; each test self-skips if it's absent.

Gotchas when adding to `tests/routes/`: route files have import-time side effects (`authRoutes`'s nothing, but `chatRoutes` constructs the AI SDK client), so any `mock.module(...)` and required env vars must run before the router is imported — since static `import` hoists above other code in the same file, importing a route module fresh requires a dynamic `await import(...)`, not a static import. Also, to simulate a rejected DB/API call, use `.mockImplementationOnce(async () => { throw ... })` on the relevant mock (e.g. `fakePool.execute`), not `.mockRejectedValueOnce(...)` — the latter constructs the rejected promise eagerly at queue time, which `bun:test`'s unhandled-rejection detector can flag as a false test failure before the code under test ever gets around to awaiting it. Adding a new router also means updating `_testUtils.ts` by hand to mount it (mirroring `index.ts`) — forgetting it 404s that router's tests loudly, which at least is easy to catch.

Since the data layer moved to Drizzle (see Server section below), `_testUtils.ts` mocks the Drizzle query-builder chain, not the raw pool — `fakePool.execute`/`.query` don't see any Drizzle-issued query. `fakeDb` exposes `select`/`insert`/`update`/`delete`/`transaction`, each backed by its own resolvable mock (`dbSelectWhereResult`, `dbSelectLimitResult`, `dbSelectOrderByResult`, `dbInsertResult`, `dbUpdateResult`, `dbDeleteResult`) — pick the one matching the query shape you're testing (`.where()` alone vs `.where().limit()` vs `.where().orderBy()` vs `.orderBy().limit()`) and configure it with `mockResolvedValueOnce`/`mockImplementationOnce`, same pattern as `fakePool` before. `fakeDb.transaction` just invokes its callback with `fakeDb` itself as `tx`, so transactional code is tested with the exact same mocks.

For authenticated route tests, `_testUtils.ts` exports `signTestAccessToken(payload)` to mint a token and `authCookie(token)` to build the `{ Cookie: "accessToken=..." }` header for `fetch()` — auth is cookie-only now, not an `Authorization` header. `decodeAccessTokenCookie(setCookieHeaderValue)` extracts and decodes the `accessToken` cookie from a `Set-Cookie` response header, for tests asserting on a freshly-issued token's payload.

Known gap, not yet investigated: now that `packages/server/.env` exists locally with a real `OPENAI_API_KEY`, `tests/evaluation/`'s eval suite no longer self-skips — a `bun test` run took ~10 minutes (vs. the usual ~2s for `tests/routes/`) and had 12 failures, almost certainly the eval suite making real API calls. If you need a fast/deterministic `bun test`, run `bun test tests/routes` specifically until this is looked into.

```bash
cd packages/server
bun test                       # runs both suites above
bun test tests/routes          # endpoint tests only (fast, no external deps)
bun test -t "<name substring>" # run a single case
bun run report                 # tests/evaluation/report.ts
bun run aggregate               # tests/evaluation/aggregate.ts
bun run gen-excel               # tests/evaluation/generate-excel.ts — build scenarios.xlsx
bun run fill-excel              # tests/evaluation/fill-excel.ts — run scenarios, fill results into an .xlsx
bun run judge-excel              # tests/evaluation/judge-excel.ts — aggregate 5 runs/scenario, judge with GPT + Gemini in parallel, export JSON + Excel
bun run eval:ci                  # tests/evaluation/ci-eval.ts — single pass, Gemini judge, compares vs. baseline.json
```

#### CI eval gate (`.github/workflows/eval-gate.yml`)

Any PR touching `utilities/prompt.config.ts` triggers a GitHub Actions job (`eval-gate.yml`) that runs `tests/evaluation/ci-eval.ts`: one live pass over all 92 `scenarios.ts` entries (not the 5-run Excel pipeline above — too slow/costly to run per-PR), judged by Gemini only (`judgeWithGeminiUsage` in `llmJudge.ts`, kept independent from the default GPT actor to avoid self-grading bias). It runs scenarios with bounded concurrency (`CI_EVAL_CONCURRENCY`, default 5) rather than report.ts's sequential loop. Results compare against the committed `tests/evaluation/baseline.json`; the job fails (blocking merge, once branch protection requires this check) if the behavioral pass rate drops more than a few points or the average judge score drops more than ~0.25 — thresholds are named constants at the top of `ci-eval.ts`. A markdown report (`results/ci-report.md`) is posted as a sticky PR comment with pass rate, per-dimension score deltas, and an estimated cost (from summed actor + judge token usage against the per-model pricing table in `ci-eval.ts`, sourced 2026-07-21 from the OpenAI/Google pricing pages — re-check those rates if the reported cost starts looking off).

`baseline.json` is never written by the PR workflow itself — only by manually dispatching `.github/workflows/promote-baseline.yml` (or running `bun run eval:ci -- --promote` locally), so a bad merge can't silently become the new baseline. Needs `OPENAI_API_KEY` and `GEMINI_API_KEY` set as GitHub Actions repo secrets; without them `ci-eval.ts` fails fast with a named-variable error rather than a raw SDK stack trace.

Two gotchas hit setting this up: (1) GitHub's branch-protection "required status checks" search only lists a check once it has actually run at least once (within the last week) for the repo — since `eval-gate.yml` only triggers on `pull_request` (no `workflow_dispatch`), first-time setup needs one deliberate PR touching `prompt.config.ts` before `eval-gate` becomes selectable. (2) Never try to test any `tests/evaluation/*.ts` script's "missing API key" path by clearing the shell environment (`env -i`, `unset`) — every script's `dotenv.config()` call loads `packages/server/.env` directly regardless of the shell env, so it'll still pick up real keys and fire live, billed API calls. Rename/move `.env` instead if you need to test that path.

## Architecture

**Monorepo** using Bun workspaces with two packages:

```
packages/
  client/   → React 19 + Vite + TypeScript frontend
  server/   → Express 5 + Bun + TypeScript backend
```

The root `index.ts` uses `concurrently` to launch both packages in parallel during development.

### Client (`packages/client`)

- **Routing:** React Router DOM in `src/shared/routing/routes.tsx`. Authenticated pages are wrapped by `PrivateRoutes.tsx`.
- **Auth state:** React Context in `src/shared/contexts/`. Both the access token and refresh token are httpOnly cookies set by the server — the client never stores or reads either (no localStorage, no `Authorization` header); `axiosConfig.ts`'s `withCredentials: true` sends them automatically. Because the cookie is invisible to JS, `AuthContext.tsx`'s `checkAuthStatus` always calls `GET /profile` on mount to learn auth state (there's no local signal to check first). `Layout.tsx` wraps `/login` and `/signup` in the same `AuthProvider` as protected routes, so this mount-time check also fires for anonymous visitors — `axiosConfig.ts`'s failed-refresh handler has a `PUBLIC_PATHS` guard to avoid force-redirecting to `/login` when already there (that redirect, unguarded, causes an infinite reload loop for every logged-out visitor). Also note: the response interceptor's own call to `/refresh-token` goes through itself, so it's explicitly exempted from the retry branch to avoid recursing on a failed refresh.
- **API layer:** Axios instance configured in `src/shared/utilities/axiosConfig.ts` with interceptors for automatic token refresh. Base URL is read from `import.meta.env.VITE_API_URL`, sourced automatically from Vite's mode-based `.env.development`/`.env.production` files — no manual editing needed.
- **UI components:** Radix UI primitives in `src/components/ui/`, styled with Tailwind CSS 4 and CVA.
- **Path alias:** `@/*` maps to `src/*` (configured in vite.config.ts and tsconfig).
- **Pages:** `src/components/` contains 40+ page components organized by feature (goal-setting workflow, wellness assessment, check-ins, chatbot, auth).

### Server (`packages/server`)

- **Entry:** `index.ts` creates an Express app and mounts six per-domain routers under `/api`: `routes/authRoutes.ts` (signup/login/refresh-token/logout), `routes/profileRoutes.ts`, `routes/checkinRoutes.ts`, `routes/goalRoutes.ts`, `routes/wellnessRoutes.ts`, and `routes/chatRoutes.ts` (conversations + the chat endpoint). Each file only imports the middleware/schemas it actually uses — there is no longer a single catch-all `userRoutes.ts`.
- **Database:** MySQL via Drizzle ORM (`db/connection.ts` exports both the Drizzle `db` instance and the raw `mysql2/promise` pool as `default`, wrapping the same pool — routes use `db`, nothing outside `db/connection.ts` should need the raw pool anymore). Schema lives in `db/schema.ts`, one `mysqlTable` per table, added incrementally as each router was migrated off raw SQL; column shapes are meant to match `db/migration.sql` exactly. Where a schema table name collides with a route's local variable name (`user`, `refreshToken` are both common local names for "the authenticated payload"/"the signed token string"), the import is aliased (`import { user as userTable } from "../db/schema"`) rather than renaming the local variable. Where a `.select()` is user-facing, its output fields are explicitly aliased to match the original snake_case wire format (e.g. `meditation_level`, not `meditationLevel`) if any client code destructures that response directly — check before trusting Drizzle's default camelCase keys. Production connects to Railway MySQL using environment variables.
- **Auth middleware:** `middleware/auth.ts` validates JWT from the `accessToken` cookie (not an `Authorization` header — the client never has the token to put in one) and checks a token blacklist table. `authRoutes.ts` also has a private `issueTokens()` helper (sign access + refresh JWTs, persist the refresh token, set both cookies) shared by `/signup`, `/login`, and `/refresh-token` — none of the three return the token in the JSON body anymore, only a `message`. `/refresh-token` returns 401 (not 500) for both a missing and an invalid/expired refresh cookie.
- **Cookies:** `cookie-parser` is wired in `index.ts` ahead of the routers, so `req.cookies` is actually populated (it wasn't for a while — `/refresh-token` and `/logout`'s cookie reads were silently dead code before this was fixed). Both `accessToken` and `refreshToken` are `httpOnly`; `secure`/`sameSite` flip on `NODE_ENV` (`secure: false` + `SameSite=Lax` outside production, `secure: true` + `SameSite=None` in production) — required for the browser to actually send the cookie cross-site between Netlify (frontend) and Railway (backend). Cookie names and the shared options helper live in `config/cookie.config.ts`, imported by both `authRoutes.ts` and `middleware/auth.ts` so the two never drift.
- **Validation:** Zod schemas with a `validateBody` middleware for request validation.
- **AI integration:** the chat endpoint in `routes/chatRoutes.ts` swaps between OpenAI (`gpt-5.4-nano`, default) and Google Gemini (`gemini-2.5-flash`) based on the `EVAL_MODEL` env var — set `EVAL_MODEL=gemini-2.5-flash` to use Gemini, anything else (or unset) uses OpenAI. Both paths share the same system prompt (`CAMAY_SYSTEM_PROMPT` in `utilities/prompt.config.ts`) and are forced to return a single JSON object matching the `SMARTGoalResponse` shape (also defined in `prompt.config.ts`) — this JSON drives a conversation state machine (`gathering_info` → `drafting_goal` → `refining_goal` → `goal_complete`), risk flagging (`utilities/riskCalculator.ts`), and goal persistence once `conversation_state === "goal_complete"`.
- **Local DB config:** `config/db.config.ts` reads from `.env` (HOST, USER, PASSWORD, DB_NAME). Production uses Railway MySQL env vars (MYSQLUSER, MYSQL_ROOT_PASSWORD, RAILWAY_TCP_PROXY_DOMAIN, etc.). Note: the production branch of `db/connection.ts` builds a MySQL URL string and calls `mysql.createPool(url)`, which parses that URL eagerly — booting locally with `NODE_ENV=production` (e.g. to check CORS/cookie behavior) crashes at import time unless the Railway env vars are at least set to syntactically-valid dummy values. The dev branch's config-object pool has no such issue; it connects lazily.
- **MySQL version gotchas (confirmed against this project's actual local MySQL 9.4.0):** `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` throws `ERROR 1064` — despite being documented as supported since MySQL 8.0.29, it does not work here in any variant tried; use a plain `ADD COLUMN` and check column existence by hand first. Also, MySQL refuses to `MODIFY` a column that's an active foreign-key target — resizing/retyping a referenced column (e.g. `user.id`) requires dropping every FK that points at it first, altering, then re-adding them. `db/migration.sql`'s "Sync" block (Section 2) hit both of these; read its comments before writing new schema-change SQL.

### Data Flow

```
Client (React) ←→ Axios ←→ Express API (/api/*) ←→ MySQL
                                  ↕
                     OpenAI / Google Gemini (via EVAL_MODEL)
```

### Authentication Flow

JWT access tokens (1d expiry) + refresh tokens (7d expiry, one-time use), both delivered as httpOnly cookies — never in a JSON response body or read by client JS. Logout blacklists the access token and clears both cookies. The client's Axios interceptor automatically calls `/api/refresh-token` on a 401 response.

## Environment Variables

**Server** requires a `.env` file in `packages/server/` — copy `packages/server/.env.example` as a starting point:
- `HOST`, `USER`, `PASSWORD`, `DB_NAME` — local MySQL connection
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — JWT signing keys
- `OPENAI_API_KEY` — OpenAI API key (default chatbot provider, `gpt-5.4-nano`)
- `GEMINI_API_KEY` — Google GenAI API key (used only when `EVAL_MODEL=gemini-2.5-flash`)
- `EVAL_MODEL` — set to `gemini-2.5-flash` to route the chatbot through Gemini instead of OpenAI
- `NODE_ENV` — `development` or `production`
- Railway MySQL vars for production: `MYSQLUSER`, `MYSQL_ROOT_PASSWORD`, `RAILWAY_TCP_PROXY_DOMAIN`, `RAILWAY_TCP_PROXY_PORT`, `MYSQL_DATABASE`

**GitHub Actions** (`.github/workflows/eval-gate.yml`, `promote-baseline.yml`) needs `OPENAI_API_KEY` and `GEMINI_API_KEY` set as repo secrets — same keys as local `.env`, added separately under Settings → Secrets and variables → Actions. Also requires manually marking `eval-gate` as a required status check in branch protection for the regression gate to actually block merging.

## Deployment

- **Frontend:** Netlify
- **Backend + Database:** Railway (Express server + MySQL)

## Key Conventions

- Zod is used for validation on both client (form schemas) and server (request body validation).
- API endpoints are split by domain into six router files under `packages/server/routes/` (`authRoutes.ts`, `profileRoutes.ts`, `checkinRoutes.ts`, `goalRoutes.ts`, `wellnessRoutes.ts`, `chatRoutes.ts`), each mounted independently at `/api` in `index.ts` — see the Server section above for what each owns. All 6 mount at the same `/api` prefix in a fixed order; nothing prevents two routers from claiming the same method+path — the earlier-mounted one would silently win, so check for collisions by hand when adding a route.
- The client uses React Hook Form + Zod resolvers for form handling.
- CORS origin (`packages/server/index.ts`) and DB connection target (`packages/server/db/connection.ts`) both switch automatically on `NODE_ENV`, which the server's `dev`/`start` scripts set explicitly (`development`/`production`) — no manual editing required.
- The client's Axios base URL (`packages/client/src/shared/utilities/axiosConfig.ts`) is likewise automatic, via `VITE_API_URL` in Vite's mode-based `.env.development`/`.env.production` files — no manual editing required.
