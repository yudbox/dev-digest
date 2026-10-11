# API Contracts

Base URL: `http://localhost:3001`

All routes use `fastify-type-provider-zod`. Every input and output is validated by Zod schemas defined in `src/vendor/shared/` (the `@devdigest/shared` package).

## Routes

### Repos

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repos` | List all repos |
| `POST` | `/repos` | Add a repo (by GitHub URL or local path) |
| `GET` | `/repos/:id` | Get repo details |

### Pulls

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/repos/:repoId/pulls` | List PRs for a repo |
| `POST` | `/repos/:repoId/pulls/import` | Import PRs from GitHub |
| `GET` | `/pulls/:id` | Get PR details (with diff) |
| `POST` | `/pulls/:id/review` | Start a review run → returns `{ runId }` |

Rate limit: `POST /pulls/:id/review` — 120/min globally.

### Reviews & Runs

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/pulls/:id/reviews` | List reviews for a PR |
| `GET` | `/reviews/:id` | Get review with findings |
| `GET` | `/runs/:id/events` | SSE stream of `RunEvent` objects |

### Agents

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/agents` | List agents |
| `POST` | `/agents` | Create agent |
| `PUT` | `/agents/:id` | Update agent |
| `DELETE` | `/agents/:id` | Delete agent |

### Performance (stats — read-only)

All four endpoints are `GET`, read only stored runs/findings, and never call an
LLM, the embedder, a review run or the CI import. Contracts live in
`contracts/performance.ts`.

| Method | Path | Returns |
|--------|------|---------|
| GET | `/agent-performance` | `AgentPerformanceResponse` — KPIs, one row per agent (+ a "Deleted agents" row when needed), cost by agent / by model (≤ 7 segments each) |
| GET | `/agents/:id/stats` | `AgentStatsResponse` — KPIs, most-used skills, most-pulled memory, severity buckets, five category counts |
| GET | `/agents/:id/runs` | `AgentRunsResponse` — run history, newest first, cursor-paged |
| GET | `/runs/:id/findings` | `RunFindingsResponse` — findings of one run (trace drawer) |

**Period query** (all but `/runs/:id/findings`): `range=1d|30d` **or** `from`+`to`
(ISO instants, at most 30 local days), plus `tz` (IANA name, required). The server
resolves it once (`modules/performance/window.ts`) and returns the resulting
`window` (bounds, buckets, previous window) so every screen agrees.

- `1d` — six fixed 4-hour local slots (00/04/08/12/16/20); the sixth is the current, incomplete one.
- `30d` — rolling 30 × 24 h ending now; five weekly buckets counted from the start, the last partial.
- custom — `[D1 00:00, D2+1 00:00)` local, capped at now; 1 day → H1…H6, 2–14 days → D1…Dn, 15–30 days → W1…Wn.

**Run history paging:** `limit` 1–50 (default 10) and an opaque `cursor` (the
`(ran_at, id)` of the last row). Cursor paging means runs created meanwhile can
neither duplicate nor skip rows.

**Errors:** a malformed period, time zone, `limit` or `cursor` is **400**
`bad_request` (not the 422 used for body/param schema failures). An id from another
workspace is **404**.

### Repo Intel

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/repos/:id/index` | Trigger symbol/import indexing |
| `GET` | `/repos/:id/map` | Get repo map (for review context) |

### Settings & Workspace

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/settings` | Get current settings (providers, models) |
| `PUT` | `/settings` | Update settings |
| `GET` | `/workspace` | Workspace status |

### Onboarding

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/repos/:id/onboarding` | Generate (or serve cached) Onboarding Tour. `?force=true` regenerates even if `headSha` is unchanged |
| `GET` | `/repos/:id/onboarding` | Get cached Onboarding Tour — `404` if none exists yet |

Rate limit: `POST /repos/:id/onboarding` — `{max: 10, timeWindow: "1 minute"}` (same shape as `brief`).

Cached per `(repoId, headSha)`, where `headSha` is the repo's last-indexed SHA (`repoIntel.getIndexState`). A `422` is returned when the workspace has no model configured for the `onboarding` feature in Settings → Feature Models.

## SSE Protocol — `GET /runs/:id/events`

The client subscribes with `EventSource`. The server emits `RunEvent` objects as newline-delimited JSON in the `data` field of each SSE message.

```typescript
// RunEvent union — defined in @devdigest/shared
type RunEvent =
  | { type: "started";   runId: string }
  | { type: "log";       runId: string; message: string }
  | { type: "progress";  runId: string; step: string; percent: number }
  | { type: "completed"; runId: string; reviewId: string }
  | { type: "failed";    runId: string; error: string }
```

Connection closes automatically on `completed` or `failed`.

## Zod Schema Locations

All schemas are in `server/src/vendor/shared/`. Key files:

| File | Contains |
|------|---------|
| `review.ts` | `Review`, `Finding`, `Severity`, `Verdict` |
| `agent.ts` | `Agent`, `CreateAgentBody` |
| `repo.ts` | `Repo`, `Pull` |
| `settings.ts` | `Settings`, `LLMProvider` enum |
| `run.ts` | `Run`, `RunEvent` |

## Error Format

All errors return:
```json
{ "statusCode": 422, "error": "Unprocessable Entity", "message": "..." }
```

Zod validation failures return `422` with the full Zod error tree in `message`.
