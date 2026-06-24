# Skills Feature — Handoff Plan

## Project Context

DevDigest: code review platform. Skills = reusable markdown instruction blocks attached to review agents. Agents inject enabled skills into the review prompt at runtime.

**Branch:** `feat/skills-and-conventions-extractor`
**Working dir:** `/Users/oleksandr_yudaiev/Coding/Projects/Rituals/ai-harness-engineering/dev-digest`

**Stack:** Fastify 5 + Drizzle ORM + Zod (server) · Next.js 15 + React 19 + TanStack Query (client) · `@devdigest/shared` = TypeScript alias to `server/src/vendor/shared/`

---

## What Is Already Done ✅

### Server — fully complete

| File | What was done |
|------|--------------|
| `server/src/modules/skills/repository.ts` | `SkillsRepository` — CRUD + versioning (`body` change → version bump + snapshot) + `listWithStats` (denormalized `agent_count`) + `stats()` (full DTO with real Drizzle queries) + `restore()` |
| `server/src/modules/skills/service.ts` | `SkillsService` — thin DTO mapper wrapping repo |
| `server/src/modules/skills/routes.ts` | 9 REST routes registered with static paths before `:id` params (see API table below) |
| `server/src/modules/index.ts` | Skills plugin registered |
| `server/src/platform/container.ts` | `skillsRepo` lazy getter added |
| `server/src/modules/reviews/run-executor.ts` | Skills injected into review pipeline before `reviewPullRequest()` — filters `enabled`, maps to `.body`, ordered by `s.order` |
| `server/src/modules/agents/repository.ts` | Added `skillCount(agentId)` + `skillCountsForWorkspace(workspaceId)` methods |
| `server/src/modules/agents/service.ts` | `list()` and `get()` now return `skill_count` |
| `server/src/db/seed.ts` | 6 skills + 1 new agent (Test Quality Reviewer) + agent-skill links added (idempotent) |

### API routes (all live)

```
POST   /skills/import           { name, body, source? } → 201 Skill
GET    /skills/:id/stats        → SkillStats
GET    /skills/:id/versions     → SkillVersionRow[]
POST   /skills/:id/restore      { version: number } → 201 Skill
GET    /skills                  → Skill[]
POST   /skills                  → 201 Skill
GET    /skills/:id              → Skill
PUT    /skills/:id              → Skill
DELETE /skills/:id              → { ok: true }
```

### Shared types (already in `server/src/vendor/shared/contracts/knowledge.ts`)

```ts
Skill, SkillType, SkillSource, AgentSkillLink
```

`SkillStats` — defined in `server/src/modules/skills/repository.ts` (not yet in shared contracts — use it directly from the API response shape):

```ts
{
  agent_count: number
  pull_frequency_pct: number
  accept_rate_pct: number
  findings_30d: number
  agents: Array<{ id: string; name: string }>
  findings_by_category: Record<string, number>
}
```

### Pre-existing TS errors (ignore)

9 errors in `server/src/modules/reviews/repository/run.repo.severity.test.ts` (TS18048) — existed before this feature, not related to skills.

### Seed data (in `server/src/db/seed.ts`)

6 skills: `PR Quality Rubric` (rubric), `No .then() Chains` (convention), `Secret Leakage Gate` (security), `Lethal Trifecta` (security), `Phantom API Gate` (security), `Test Coverage Nudge` (custom).

Agent links:
- Security Reviewer → PR Quality Rubric, Secret Leakage Gate, Lethal Trifecta
- Test Quality Reviewer → PR Quality Rubric, Test Coverage Nudge, No .then() Chains, Phantom API Gate
- General Reviewer → no skills (baseline)

---

## What Needs to Be Done ❌

### Task 3 — Client: TanStack hooks

**File to create:** `client/src/lib/hooks/skills.ts`

Follow the exact pattern of `client/src/lib/hooks/agents.ts` (use `"use client"`, use `useQuery`/`useMutation`/`useQueryClient`, import `api` from `../api`).

```ts
// Query keys: ["skills"], ["skill", id], ["skill-stats", id], ["skill-versions", id]

useSkills()              → GET /skills → Skill[]
useSkill(id)             → GET /skills/:id → Skill  (enabled: !!id)
useCreateSkill()         → POST /skills  (invalidates ["skills"])
useImportSkill()         → POST /skills/import  (invalidates ["skills"])
useUpdateSkill()         → PUT /skills/:id  (invalidates ["skills"], setQueryData ["skill", id])
useDeleteSkill()         → DELETE /skills/:id  (invalidates ["skills"], removeQueries ["skill", id])
useSkillStats(id)        → GET /skills/:id/stats  (enabled: !!id, staleTime: 30_000)
useSkillVersions(id)     → GET /skills/:id/versions  (enabled: !!id)
useRestoreSkill()        → POST /skills/:id/restore { version }  (invalidates ["skills","skill","skill-versions"])
```

**File to modify:** `client/src/lib/hooks/index.ts` — add `export * from "./skills";`

Also need agent-skills hooks — check if `useAgentSkills(agentId)` and `useSetAgentSkills()` already exist in `client/src/lib/hooks/agents.ts`. If missing, add them:

```ts
useAgentSkills(agentId)  → GET /agents/:id/skills → AgentSkillLink[]
useSetAgentSkills()      → POST /agents/:id/skills { skill_ids: string[] } → AgentSkillLink[]
                            (invalidates ["agent-skills", agentId])
```

---

### Task 4 — Client: Skills list page (`/skills`)

**Layout:** Split pane — skill list on the left, skill editor on the right (navigating to `/skills/[id]`).

**Files to create:**

```
client/src/app/skills/
  page.tsx                          ← RSC shell (redirect to first skill or show empty state)
  layout.tsx                        ← split pane layout wrapper
  _components/
    SkillsListView/
      SkillsListView.tsx            ← "use client", list of SkillCards + search + "New Skill" button
    SkillCard/
      SkillCard.tsx                 ← name, type badge, description, enabled toggle, stats line
    CreateSkillModal/
      CreateSkillModal.tsx          ← two tabs: Create (manual) | Import (file)
```

**SkillCard** shows: name, type badge (color-coded), description (truncated), enabled toggle (`PUT /skills/:id { enabled }`), stats line: `"N agents · X% pull · Y% accept"`.

> Note: current `GET /skills` returns plain `Skill[]` without stats fields. Either extend the server list response to include `agent_count` / `pull_frequency_pct` / `accept_rate_pct` (server already has `listWithStats` in repository), or omit the stats line from the card for MVP.

**CreateSkillModal — Create tab:** name + description + type dropdown + body textarea → `useCreateSkill()`

**CreateSkillModal — Import tab:**
- File input: accepts `.md` and `.zip`
- `.md` → `FileReader.readAsText()` → show body preview → user sets name + type → `useImportSkill()` with `{ name, body, source: 'imported_file' }`
- `.zip` → install `fflate` in `client/` only (`cd client && pnpm add fflate`) → `fflate.unzipSync(buffer)` → filter only `*.md` entries (silently drop `.sh`, `.py`, `.js`, `.ts`, binaries) → if multiple `.md` → show picker list → select one → body preview → user sets name + type → `useImportSkill()`
- **Server never receives ZIP** — client extracts, sends clean `{ name, body }` JSON

---

### Task 5 — Client: Skill editor page (`/skills/[id]`)

**Files to create:**

```
client/src/app/skills/[id]/
  page.tsx                          ← RSC shell
  _components/
    SkillEditor/
      SkillEditor.tsx               ← "use client", 4-tab layout, tab routing via ?tab=
      constants.ts                  ← TABS = ['config','preview','stats','versions']  (NO evals)
      _components/
        ConfigTab/ConfigTab.tsx
        PreviewTab/PreviewTab.tsx
        StatsTab/StatsTab.tsx
        VersionsTab/VersionsTab.tsx
```

**Tab routing:** `?tab=config` (default) / `?tab=preview` / `?tab=stats` / `?tab=versions`

#### Config tab

Fields:
- Name (required text input)
- Description (textarea)
- Type (dropdown: rubric / convention / security / custom)
- Body — monospace textarea with:
  - CSS line numbers (no extra deps)
  - Filename badge: `skill-name.md`
  - "unsaved" badge when dirty
  - Token counter top-right: `Math.ceil(body.length / 4)` tokens
- Enabled toggle (top-right of header)
- Save button → `useUpdateSkill()`

#### Preview tab

Read-only. Renders `skill.body` as markdown.
Header: "Preview" + subtitle "Rendered as the reviewing agent receives it."
Use existing markdown renderer if present in the codebase; otherwise a styled `<pre>` block with monospace font.

#### Stats tab

Fetches `useSkillStats(id)`.

Top row — 4 stat cards:

| Card | Field |
|------|-------|
| USED BY | `agent_count` agents |
| PULL FREQUENCY | `pull_frequency_pct`% |
| ACCEPT RATE | `accept_rate_pct`% + circular gauge via CSS |
| FINDINGS (30D) | `findings_30d` |

Bottom row — 2 cards:
- **AGENTS USING THIS SKILL** — list of `{ id, name }` each with "Open" link → `/agents/:id`
- **FINDINGS BY CATEGORY** — donut via CSS `conic-gradient` + legend `{ category → count }`. No chart library.

#### Versions tab

Fetches `useSkillVersions(id)`.

- Header: "Version history" + `"N versions"` badge
- Subtitle: "Every save snapshots the body so eval runs stay reproducible against the exact text they scored."
- Current version (highest number): green "● Current" badge, no action buttons
- Older versions: each row has date + **Diff** button (expand inline to show that version's body text) + **Restore** button → `useRestoreSkill()` with `{ skillId: id, version: N }`

---

### Task 6 — Client: Agent editor Skills tab

**Files to modify:**

- `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`
  — add `{ key: 'skills', label: t('skills') }` to TABS array

- `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`
  — render `<SkillsTab agentId={id} />` when `tab === 'skills'`

- `client/src/app/agents/_components/AgentsListView/AgentsListView.tsx`
  — pass `skillCount={a.skill_count}` to `<AgentCard>` (prop already wired in AgentCard, just not passed)

**File to create:**

```
client/src/app/agents/[id]/_components/AgentEditor/_components/SkillsTab/SkillsTab.tsx
```

**SkillsTab behaviour:**
- Fetches all workspace skills: `useSkills()`
- Fetches agent's linked skills: `useAgentSkills(agentId)` → `GET /agents/:id/skills`
- Shows every workspace skill as a row: drag handle `≡`, checkbox (checked = linked to agent), name, type badge
- Header: `"Skills X of Y enabled"` + search filter input
- Note: "Order matters — earlier skills appear earlier in the assembled prompt. Drag to reorder."
- Toggle checkbox → recompute ordered `skill_ids` → `useSetAgentSkills()` → `POST /agents/:id/skills { skill_ids }`
- Drag reorder → same endpoint after drop

**Native HTML5 drag-and-drop (zero dependencies):**

```tsx
<div
  draggable={isLinked}
  onDragStart={(e) => e.dataTransfer.setData('skillId', skill.id)}
  onDragOver={(e) => e.preventDefault()}
  onDrop={(e) => {
    const draggedId = e.dataTransfer.getData('skillId');
    // reorder linkedIds array, then POST /agents/:id/skills { skill_ids: newOrder }
  }}
>
  <span style={{ cursor: 'grab' }}>≡</span>
  ...
</div>
```

Only linked (checked) skills are draggable. Unlinked skills have no active drag handle. One POST fires after each drop — no optimistic state for MVP.

---

### Task 7 — Typecheck both packages

```bash
cd server && pnpm typecheck
# Expect: only 9 pre-existing TS18048 errors in run.repo.severity.test.ts — nothing else

cd client && pnpm typecheck
# Expect: 0 errors
```

---

## Key Reuse Patterns

| What | Where |
|------|-------|
| API fetch layer | `client/src/lib/api.ts` — `api.get`, `api.post`, `api.put`, `api.del` |
| Hooks pattern | `client/src/lib/hooks/agents.ts` |
| Tab pattern | `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx` + `constants.ts` |
| i18n keys | `client/messages/en/skills.json` — already exists |
| `@/` alias | Use `@/` for all imports in `client/` — never `../../../` |
| Shared types | `import type { Skill, SkillType, SkillSource, AgentSkillLink } from '@devdigest/shared'` |
| Sidebar nav | `/skills` → `"skills"` already wired in `client/src/components/app-shell/helpers.ts:33` |

---

## Important Constraints

- **No Evals tab** — design has 5 tabs on the skill editor, only implement 4: Config, Preview, Stats, Versions
- **`fflate` goes in `client/` only** — pnpm store v10/v11 conflict means no new deps in `server/`; run `cd client && pnpm add fflate`
- **All user-facing strings through `useTranslations()`** — no hardcoded English in JSX
- **`"use client"` only when needed** — RSC by default in Next.js 15
- **Import tab: server never sees ZIP** — client extracts, sends clean `{ name, body }` JSON
- **Drag-and-drop: native HTML5 only** — zero extra dependencies
