# Server Insights

Non-obvious discoveries from real sessions. Specific and actionable — pass the cold-read test.
See also: `insights/gotchas.md` for known quirks at project start.

---

## What Works

2026-06-20 — `ContainerOverrides` is the correct test-double injection point for all adapters — pass mocks via `new Container(config, db, { llm: { openai: new MockLLMProvider() }, github: new MockGitHubClient() })`. Using `vi.mock()` on an adapter module file is a code smell here: if you need it, the dependency should be constructor-injected instead. ref: server/src/adapters/mocks.ts:1

2026-06-21 — `safeFetchSkillUrl` streams the response body to enforce the 100KB limit without buffering the full payload: `reader.cancel()` is called once the running total exceeds `MAX_BYTES`. Using `res.arrayBuffer()` would let an oversized payload into memory before the check. The streaming approach is the correct pattern for size-guarded fetches. ref: server/src/modules/skills/routes.ts:65

2026-06-21 — Conventions extractor verifies LLM-returned evidence before accepting candidates: `verifyEvidence()` reads the file at `evidence_path` and checks that the first line of `evidence_snippet` literally appears in its content. LLM hallucinated file paths or invented snippets silently fail this check and are dropped. No verification = hallucinated conventions reach the DB. ref: server/src/modules/conventions/extractor.ts:35

2026-06-18 — Unit-testing a drizzle repo function with two sequential queries: mock `db.select()` with a call counter; each call returns a fresh chain where `.orderBy()` (first query) or `.groupBy()` (second query) resolves with the appropriate fixture data. All intermediate chain methods (`from`, `leftJoin`, `innerJoin`, `where`) return `this`. Pattern validated for `listRunsForPull`. ref: server/src/modules/reviews/repository/run.repo.severity.test.ts:53

## What Doesn't Work

2026-06-17 — `selectDistinctOn([agentRuns.prId])` for cost silently returns null when the most recent run errored (`cost_usd = null`). DISTINCT ON picks the newest row regardless of whether the value is null — so a trailing error run zeros out the entire COST column. Fix: use `sql\`sum(${t.agentRuns.costUsd})\`` with `.groupBy(t.agentRuns.prId)` — SQL SUM skips nulls, so error runs don't affect the total. ref: server/src/modules/pulls/routes.ts:122

## Codebase Patterns

2026-06-21 — Fastify route registration order: `/skills/import` and `/skills/:id/stats|versions|restore` MUST be registered before `/skills/:id`. Fastify matches literal path segments first only if they are registered first — "import" otherwise binds as a UUID param and returns 404. Documented in a NOTE comment at the top of `skillsRoutes`. ref: server/src/modules/skills/routes.ts:27

2026-06-21 — `SkillsRepository.update()` only bumps `version` when `body` actually changes (new value !== existing). Metadata changes (name, description, enabled, type) are NOT versioned. A body change also resets `threat_level` to `"unknown"` so the synchronous re-scan on `PUT /skills/:id` starts from a clean slate. ref: server/src/modules/skills/repository.ts:154

2026-06-21 — Scan strategy differs by route: `PUT /skills/:id` runs regex + LLM scan **synchronously** so the response body contains the final `threat_level`. `POST /skills/import-url` runs regex synchronously (result goes into DB immediately) then fires LLM scan **in background** after `reply.status(201)` is sent — the background result upgrades the DB row asynchronously. ref: server/src/modules/skills/routes.ts:140

2026-06-21 — Threat level is never downgraded from `"dangerous"`. LLM scan result is applied via a severity map `{ safe:0, unknown:1, suspicious:2, dangerous:3 }` — it replaces the current level only when its numeric rank is strictly higher. A `DANGEROUS` regex result cannot be softened by a `safe` LLM result. ref: server/src/modules/skills/routes.ts:272

2026-06-21 — Skills from untrusted sources (`imported_url`, `community`) are wrapped in `<untrusted source="skill:…"> … </untrusted>` delimiters before injection into the review prompt. The skill body's own `</untrusted>` tags are escaped to prevent breakout. Manual and extracted skills pass through unwrapped (trusted). ref: server/src/modules/reviews/run-executor.ts:244

2026-06-21 — `PATCH /repos/:repoId/conventions/:id` is a polymorphic endpoint: `{ rule: string }` → inline edit; `{ accepted: true }` → accept; `{ accepted: false }` → reject + delete; both absent → `ValidationError`. `rule` takes priority if present alongside `accepted`. ref: server/src/modules/conventions/routes.ts:57

2026-06-20 — Layer mapping for Onion Architecture: Domain=`src/vendor/shared/contracts/` (pure TS types, zero framework imports), Application=`modules/*/service.ts` (orchestration, no SQL), Infrastructure=`modules/*/repository.ts` + `src/adapters/` (Drizzle, Octokit, OpenAI SDK), Presentation=`modules/*/routes.ts` (Fastify handlers). Documented in `.claude/skills/onion-architecture/`. ref: server/src/platform/container.ts:1

2026-06-20 — `src/platform/` is NOT an architectural layer — it is cross-cutting infrastructure (Container, RunBus, JobRunner, AppError, AppConfig) that any layer may import without violating the inward-only dependency rule. Treating it as a layer and avoiding imports from it is a mistake. ref: server/src/platform/container.ts:1

2026-06-20 — Cross-module data access: a service must never import another module's `repository.ts` directly. Instead, shared repositories are pre-built as properties on `Container` (e.g. `container.agentsRepo`). To add cross-module data access, add a property to `Container` first, then use it via `this.container.X`. ref: server/src/platform/container.ts:1

2026-06-20 — `getContext(container, req)` is the mandatory first call in every Fastify route handler — it extracts `workspaceId` + `userId` from the auth context. Never read `workspaceId` from `req.headers` manually in a handler; always go through `getContext`. ref: server/src/modules/_shared/context.ts:1

2026-06-18 — `agent_runs` stores only total `findingsCount` and `blockers` — no per-severity breakdown. To get critical/warning/suggestion counts per run, use: `findings` JOIN `reviews` (on `reviews.id = findings.reviewId`), filter `inArray(t.reviews.runId, runIds)`, group by `(reviews.runId, findings.severity)`. Second query pattern, merge into result map. ref: server/src/modules/reviews/repository/run.repo.ts:51

2026-06-17 — `nullish()` (not `nullable()` or `optional()`) is the convention for optional DTO fields in `platform.ts`. Use `z.number().nullish()` for fields that may be absent from older DB rows — accepts both `null` and `undefined` from Drizzle. ref: server/src/vendor/shared/contracts/platform.ts:157

## Tool & Library Notes

2026-06-17 — `sql` template tag from `drizzle-orm` is NOT included in the common named-export bundle used in this file (`and, desc, eq, inArray`). When adding raw SQL expressions (e.g. `sql\`sum(...)\``), add `sql` to the import explicitly: `import { and, desc, eq, inArray, sql } from 'drizzle-orm'`. Missing it gives a "sql is not defined" runtime error, not a TS error. ref: server/src/modules/pulls/routes.ts:3

2026-06-17 — Drizzle `selectDistinctOn([col])` requires the first `orderBy()` column to match the DISTINCT ON column. For "latest row per group": `.selectDistinctOn([t.agentRuns.prId], {...}).orderBy(t.agentRuns.prId, desc(t.agentRuns.ranAt))`. Without the matching prId in orderBy, Postgres throws "SELECT DISTINCT ON expressions must match initial ORDER BY expressions". ref: server/src/modules/pulls/routes.ts:1

## Recurring Errors & Fixes

2026-06-18 — `POST /settings/test-connection` with provider `anthropic` calls `llm.listModels()` → `GET https://api.anthropic.com/v1/models`. If a student tests their key with `curl .../v1/messages` and it works, but test-connection returns "Invalid response body... Premature close", the issue is a network/VPN/ISP block on the `/v1/models` endpoint specifically — not an invalid key. Fix: reproduce with `curl https://api.anthropic.com/v1/models -H "x-api-key: KEY" -H "anthropic-version: 2023-06-01"` to confirm, then disable VPN or switch to mobile hotspot. ref: server/src/modules/settings/routes.ts:92

## Session Notes

2026-06-21 — Skills Lab (server): SkillsRepository (CRUD + versioning + `skill_versions` snapshots), SkillsService, 9 REST routes including `/skills/import-url` with SSRF protection. Skills injected into review pipeline in run-executor with untrusted-source wrapping. DB seeded with 6 skills + agent-skill links. Files: server/src/modules/skills/repository.ts, service.ts, routes.ts, scanner.ts, src/modules/reviews/run-executor.ts.

2026-06-21 — Conventions extractor: LLM-based extraction from top-12 repo files + config files, post-extraction evidence verification, PATCH accept/reject/edit, POST createSkillFromAccepted. Files: server/src/modules/conventions/extractor.ts, service.ts, repository.ts, routes.ts.

2026-06-20 — Created `onion-architecture` skill (8 rule files) to formally document the layered architecture already present in the codebase. Key discovery: the project is already ~80% Onion-compliant but has no documents enforcing it. Files: .claude/skills/onion-architecture/SKILL.md, rules/layers.md, rules/dependency-rule.md, rules/di-container.md.

2026-06-18 — Added `findings_critical/warning/suggestion` to `RunSummary`: second query in `listRunsForPull` via `findings → reviews JOIN`, grouped by `(runId, severity)`. No migration needed — `findings.severity` column already existed. Files: server/src/modules/reviews/repository/run.repo.ts, server/src/vendor/shared/contracts/trace.ts.

2026-06-17 — COST column showed '–' for PRs with a trailing errored run → replaced `selectDistinctOn` with `sql\`sum\`` + `groupBy`. Root cause: DISTINCT ON returns the newest row even when its cost is null. Files: server/src/modules/pulls/routes.ts.

2026-06-17 — Run Cost Badge: added `last_run_cost_usd` to PR list response. Used `selectDistinctOn` subquery to get most recent agent run cost per PR in a single query (no N+1). No migration needed — `agent_runs.cost_usd` column already existed in the schema. Files: server/src/modules/pulls/routes.ts, server/src/vendor/shared/contracts/platform.ts.

## Open Questions
