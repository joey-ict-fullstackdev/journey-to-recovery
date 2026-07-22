# Handoff: Risk escalation pipeline — complete

The risk escalation pipeline is fully shipped as of commit `883cab9`. This document is for someone picking this up cold with zero session memory.

## What the pipeline does end-to-end

1. **Risk scoring** — every patient chat message is scored by `packages/server/utilities/riskCalculator.ts`. If the score exceeds the threshold, `chatRoutes.ts` inserts a row into `alerts`.
2. **Clinician alert queue** — `alertRoutes.ts` exposes 5 routes; `AlertQueuePage.tsx` is the clinician-only UI at `/alerts`. Clinicians can acknowledge or resolve alerts, leave notes, and review the audit trail for each non-open alert.
3. **NavBar badge** — `GET /alerts/count` returns the open-alert count; the NavBar polls it to show an unread badge to clinicians.
4. **Daily digest** — `scripts/daily-digest.ts` (cron via `daily-digest.yml` at 08:00 UTC) emails a summary table of all open alerts to every clinician account via Resend.
5. **CI eval gate** — any PR touching `prompt.config.ts` triggers `eval-gate.yml`, which runs the 92-scenario harness (Gemini judge) and blocks merge on regression against `baseline.json`.

## Everything committed (as of `883cab9`)

| Commit | What landed |
|---|---|
| `2b3dacd` | Schema: `alerts` table, risk fields on `conversations` |
| `150d719` | Risk calculator, alert insertion, clinician queue (Step 3) |
| `6500766` | Patient name on all alert routes, alert history tab, NavBar badge |
| `b6c26f9` | GET /alerts/:id patient JOIN, DIGEST_FALLBACK_EMAIL, alertSelectBase dedup |
| `c35d6ee` | Patient name in digest, 500 test for GET /alerts/:id |
| `7403baa` | "Note on file" on open cards, audit-trail expand on history cards |
| `883cab9` | 6 code-review fixes (see below) |

Earlier commits cover the CI eval gate, knowledge graph, and prior pipeline steps — see `git log --oneline` for the full picture.

## The 6 code-review fixes in `883cab9`

1. **Patient email in digest** — digest table was showing name-only for named patients, hiding the contact address. Now shows `Name <email>` (or email alone when name is null).
2. **`acknowledgedBy` resolved to email** — the `acknowledged_by` DB column stores a UUID FK; GET /history and GET /:id now LEFT JOIN a `clinicianAlias = alias(userTable, "clinician")` and return `clinicianAlias.email` in the `acknowledgedBy` response field. The DB schema and PATCH handler are unchanged — resolution is read-only.
3. **Stale-request guard in `useEffect`** — rapid tab switches caused the first fetch's `.finally(() => setLoading(false))` to fire while the second fetch was still in flight, briefly flashing an empty list. Fixed with a `cancelled` flag that gates all state updates in the promise chain.
4. **`expandedId` reset on tab switch** — switching tabs and returning auto-expanded the last-clicked history card. `setExpandedId(null)` now fires alongside `setView(v)` in the tab button's `onClick`.
5. **"Previous note" label** — renamed "Previous note:" to "Note on file:" so it's clear the existing note will be replaced on submit, not appended.
6. **`aria-expanded` / `aria-controls`** — Details toggle button now announces its expanded/collapsed state to screen readers (WCAG 2.1 SC 4.1.2).

## Gotchas — things that will bite you cold

### `alias` must come from `drizzle-orm/mysql-core`, not `drizzle-orm`

This is not documented anywhere in Drizzle's main README. `import { alias } from "drizzle-orm"` compiles but throws at runtime:

```
SyntaxError: Export named 'alias' not found in module 'drizzle-orm/index.js'
```

The correct import is:

```typescript
import { alias } from "drizzle-orm/mysql-core";
```

All other Drizzle query helpers (`eq`, `ne`, `desc`, `count`, `and`, `or`, `sql`, etc.) come from `drizzle-orm`. `alias` is the exception.

### Double-joining `user` as patient + clinician requires a table alias

`alertRoutes.ts` joins the `user` table twice for GET /history and GET /:id — once for the patient (`INNER JOIN user ON alerts.user_id = user.id`), once for the acknowledging clinician (`LEFT JOIN user AS clinician ON alerts.acknowledged_by = clinician.id`). Drizzle requires a table alias for the second join:

```typescript
import { alias } from "drizzle-orm/mysql-core";
const clinicianAlias = alias(userTable, "clinician");
// then in the query:
.innerJoin(userTable, eq(alerts.userId, userTable.id))
.leftJoin(clinicianAlias, eq(alerts.acknowledgedBy, clinicianAlias.id))
```

The chain `.innerJoin().leftJoin().where()` is now also mocked in `_testUtils.ts` — the `innerJoin` mock result has a `leftJoin` key that feeds into the normal `makeWhereChain()`. If you add another route with this pattern, no new mock exports are needed.

### EVAL_MODEL=openai prefix is required for fast test runs

The local `.env` sets `EVAL_MODEL=gemini-2.5-flash`. Without the prefix, `bun test tests/routes` routes `chatRoutes.ts` through the unmocked Gemini SDK and fails all chat tests. Always run:

```bash
EVAL_MODEL=openai bun test tests/routes
```

### Mock throw pattern: `mockImplementationOnce` not `mockRejectedValueOnce`

To simulate a DB failure in `tests/routes/`:

```typescript
// correct
dbSelectWhereResult.mockImplementationOnce(async () => { throw new Error("boom") });

// wrong — bun:test's unhandled-rejection detector flags the eagerly-created
// rejected promise before the code under test ever awaits it
dbSelectWhereResult.mockRejectedValueOnce(new Error("boom"));
```

## Open items (no code needed — manual actions)

1. **Production smoke test** — deploy to Railway, then manually verify: chat a high-risk message → alert appears in the clinician queue → acknowledge/resolve it → confirm it moves to history with the correct audit trail → run `bun run digest` and confirm the email arrives with both name and email in the Patient column.
2. **`promote-baseline.yml` untested via GitHub Actions** — the current `baseline.json` (92/92 pass) was promoted with a local `bun run eval:ci -- --promote` run, not through the workflow. The workflow itself has never been dispatched; it should work but hasn't been exercised end-to-end.

## Quick-reference commands

```bash
# Tests (fast, ~2s, no external deps)
cd packages/server
EVAL_MODEL=openai bun test tests/routes

# Full type check (client)
cd packages/client && bun run build

# Eval / CI gate
cd packages/server
bun run eval:ci                        # WARNING: hits real APIs (OpenAI + Gemini), costs money
bun run eval:ci -- --promote           # update baseline after an intentional prompt change

# Daily digest (production DB)
bun run digest                         # NODE_ENV=production, hits Railway MySQL
# Against local MySQL instead:
bun run scripts/daily-digest.ts        # no NODE_ENV override, uses local config
```
