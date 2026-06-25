# Claude Code Agents — DevDigest

Дисциплинированный конвейер разработки на основе специализированных агентов.

## Pipeline

```
researcher  ──────────────────────────────────────────  Explore фаза
    │
    │  (делегирование разведки)
    ▼
planner  ──→  specs/PLAN-*.md  ──────────────────────  Plan фаза
                    │
          ┌─────────┴─────────┐
          ▼                   ▼
  implementer [backend]  implementer [frontend]         Implement фаза (параллельно)
  server/ scope          client/ scope
          │                   │
     typecheck+tests     typecheck+tests                self-verification
     AC checklist        AC checklist
          │                   │
          ▼                   ▼
  test-writer [*.it.test.ts]  test-writer [*.test.tsx]  Test фаза (параллельно)
          └─────────┬─────────┘
                    ▼
        architecture-reviewer  ─────────────────────  Architecture gate
                    │
                    ▼
             pr-self-review  ────────────────────────  официальный гейт (скил)

  plan-viewer  ◄── (AC verification / трейсабилити требований)  — on-demand
  doc-writer   ◄── (session end / документирование)             — on-demand
```

---

## Агенты

### `planner.md`

**Триггер:** пользователь описывает фичу, рефакторинг или изменение и нужен план до написания кода.

**Модель:** `opus` — глубокое рассуждение при анализе кодовой базы.

**Tools:** `Read`, `Write`, `Agent`, `Skill`

**Skills preloaded (startup):**
- `onion-architecture` — слои backend, dependency rule, DI
- `frontend-architecture` — структура client, RSC границы, file placement
- `mermaid-diagram` — диаграммы в plan-файлах

**Skills on-demand (via Skill tool во время написания плана):**
- `fastify-best-practices` — при планировании routes/plugins
- `drizzle-orm-patterns` — при планировании DB запросов
- `postgresql-table-design` — при планировании schema design
- `zod` — при планировании contracts/validation
- `next-best-practices` — при планировании App Router/RSC
- `react-best-practices` — при планировании компонентов/хуков
- `typescript-expert` — при планировании сложных типов
- `security` — при планировании auth/input handling

**Что делает:**
1. `STEP 0` — Interview Mode: оценивает запрос, задаёт ≤3 уточняющих вопроса если нужно
2. `STEP 1` — Делегирует разведку `researcher` агенту (survey кода + извлечение релевантных инсайтов из INSIGHTS.md)
3. `STEP 2` — Оценивает findings, при необходимости уточняет
4. `STEP 3` — Пишет `specs/PLAN-<name>.md`

**Формат plan-файла:** Problem → Affected Modules → Tasks (TASK-001 + Owned Paths + Acceptance Criteria + Verification) → Phases (DB/Backend/Frontend/Tests) → Risks → Out of Scope

**Ограничения:**
- NEVER пишет код
- NEVER изменяет существующие файлы (нет Edit в tools)
- NEVER пишет вне `specs/`
- Owned paths между параллельными задачами НИКОГДА не пересекаются

---

### `implementer.md`

**Триггер:** существует `specs/PLAN-*.md` и пользователь хочет его выполнить.

**Модель:** `sonnet` — выполнение уже принятых решений.

**Tools:** `Read`, `Edit`, `Write`, `Bash`, `Grep`, `Glob`, `Skill`

**Skills preloaded (startup — cross-cutting, нужны всегда):**
- `typescript-expert` — strict-mode TypeScript, и server/, и client/
- `security` — XSS, input validation, secrets — оба направления

**Skills on-demand — Backend scope** (`server/`):
| Скил | Когда |
|------|-------|
| `onion-architecture` | Первым — перед любым backend файлом |
| `fastify-best-practices` | Fastify plugins, hooks, decorators, SSE |
| `drizzle-orm-patterns` | `repository.ts` или Drizzle запросы |
| `postgresql-table-design` | Phase 1: schema design |
| `zod` | `routes.ts` или `vendor/shared/contracts/` |
| `engineering-insights` | В конце → `server/insights/INSIGHTS.md` |

**Skills on-demand — UI scope** (`client/`):
| Скил | Когда |
|------|-------|
| `frontend-architecture` | Первым — перед любым client файлом |
| `next-best-practices` | App Router, RSC, route handlers, data fetching |
| `react-best-practices` | Компоненты и хуки |
| `react-testing-library` | Phase 4: component tests |
| `zod` | `@devdigest/shared` контракты |
| `engineering-insights` | В конце → `client/insights/INSIGHTS.md` |

**Что делает:**
1. `STEP 0` — Захватывает `START_SHA=$(git rev-parse HEAD)`, читает INSIGHTS.md своего scope
2. Читает `specs/PLAN-*.md`, определяет scope (backend/UI)
3. Загружает первый скил ветки (onion-architecture или frontend-architecture)
4. Имплементирует фазы по порядку
5. После каждой фазы: `typecheck + tests`
6. После каждого TASK: AC Verification по таблице из плана
7. `STEP FINAL` — вызывает `pr-self-review` на `git diff $START_SHA...HEAD`

**Owned Paths:** работает только с путями из плана. При конфликте — STOP.

**Forbidden files (абсолютный запрет):**
- Lock files: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`
- DB migrations: `server/drizzle/migrations/**`
- Root configs: `tsconfig*.json`, `package.json`, `.eslintrc*`, `tailwind.config*`, `next.config*`, `vite.config*`
- Foreign contracts: `vendor/shared/contracts/` вне owned paths

---

### `researcher.md`

**Триггер:** поиск, исследование, "найди", "где определён", "покажи все места".

**Модель:** `sonnet`

**Tools:** `Read`, `Grep`, `Glob`, `LS`, `Bash`, `WebFetch`, `WebSearch`

Read-only специалист. Используется planner'ом для делегирования разведки кодовой базы и фильтрации INSIGHTS.md.

---

### `test-writer.md`

**Триггер:** написание или обновление тестов для существующей реализации.

**Модель:** `sonnet` — исполнение, не творческое проектирование.

**Tools:** `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill` | `permissionMode: acceptEdits`

**Skills preloaded:** `react-testing-library`, `typescript-expert`, `zod`

**Skills on-demand:** `react-best-practices`, `next-best-practices`, `frontend-architecture`, `fastify-best-practices`, `onion-architecture`, `drizzle-orm-patterns`, `postgresql-table-design`, `security`

**Что делает:**
1. `STEP 0` — читает исходники, план (если AC-based), INSIGHTS.md модуля
2. `STEP 1` — определяет конвенцию: `*.test.ts` (unit/component) или `*.it.test.ts` (integration)
3. `STEP 2` — выводит сценарии из поведения, не из строк кода; каждый AC → один тест
4. `STEP 3` — пишет тесты: frontend (RTL), backend unit (mock DI), backend IT (testcontainers)
5. `STEP 4` — **обязательный self-correction loop**: запускает тест, фиксит падения, только потом done

**Ограничения:** E2E тесты (Playwright) — out of scope. Не запускает тесты для других агентов.

---

### `architecture-reviewer.md`

**Триггер:** архитектурное ревью — нарушения слоёв, SOLID, направление зависимостей.

**Модель:** `opus` — субъективные суждения о нарушениях требуют глубокого reasoning.

**Tools:** `Read`, `Grep`, `Glob`, `Bash`, `Skill` — **без Write/Edit**

**Skills preloaded:** `onion-architecture`, `typescript-expert`, `security`

**Skills on-demand:** `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `postgresql-table-design`, `frontend-architecture`, `next-best-practices`, `react-best-practices`

**Onion layer map (hardcoded в агенте):**
| Layer | Paths |
|---|---|
| Domain | `reviewer-core/src/domain/`, `server/src/vendor/shared/contracts/` |
| Application | `server/src/modules/*/service.ts`, `*/helpers.ts` |
| Infrastructure | `server/src/modules/*/repository.ts`, `server/src/adapters/**`, `server/src/platform/**` |
| Presentation | `client/src/**`, `server/src/modules/*/routes.ts` |
| Composition Root | `server/src/platform/container.ts` — разрешено всё |

**Формат вывода:**
```
VIOLATION [CRITICAL|HIGH|MEDIUM|LOW] — <тип>
File:     <path>:<line>
Rule:     <правило>
Evidence: <сниппет>
Fix:      <конкретный фикс одной строкой>
```

**Ограничения:** NEVER пишет код, NEVER предлагает правки — только диагностика.

---

### `plan-viewer.md`

**Триггер:** проверка что все AC из `specs/PLAN-*.md` реализованы в коде.

**Модель:** `opus` — семантическое понимание требований vs реализации.

**Tools:** `Read`, `Grep`, `Glob`, `Bash`, `Skill` — **без Write/Edit**

**Skills preloaded:** `onion-architecture`

**Что делает:**
1. `STEP 0` — Interview Mode: уточняет какой план проверять
2. `STEP 1` — парсит `specs/PLAN-*.md`, извлекает все TASK-XXX и AC-XXX
3. `STEP 2` — по каждому AC: tokenize → grep owned paths → read файл → classify
4. `STEP 3` — выводит coverage matrix: ✅ IMPLEMENTED / ⚠️ PARTIAL / ❌ MISSING с file:line

**Ключевое правило:** тест-файлы (`*.test.ts`, `*.it.test.ts`) ≠ implementation evidence.

---

### `doc-writer.md`

**Триггер:** документирование написанного кода, конвертация планов в docs, добавление Mermaid диаграмм.

**Модель:** `sonnet` — качественное письмо, не глубокое reasoning.

**Tools:** `Read`, `Write`, `Edit`, `Grep`, `Glob`, `Bash`, `Skill` | `permissionMode: acceptEdits`

**Skills preloaded:** `mermaid-diagram`

**Skills on-demand:** `onion-architecture`, `fastify-best-practices`, `frontend-architecture`, `drizzle-orm-patterns`, `next-best-practices`, `react-best-practices`, `zod`

**Doc location map (hardcoded в агенте):**
| Что | Файл |
|---|---|
| API routes / contracts | `server/docs/api-contracts.md` |
| Server architecture / DI | `server/docs/architecture.md` |
| Review pipeline | `reviewer-core/docs/pipeline.md` |
| E2E flows | `e2e/docs/flows.md` |
| AI context (server) | `server/CLAUDE.md` |
| AI context (client) | `client/CLAUDE.md` |
| Root overview | `README.md` |
| Новая фича | `server/docs/<feature-name>.md` |

**Ограничения:** пишет только `.md` файлы. NEVER создаёт новые `docs/` директории.

---

## Все скилы проекта

| Скил | Назначение | Кто использует |
|------|-----------|----------------|
| `onion-architecture` | Слои backend: Domain→Application→Infrastructure→Presentation. Dependency rule, DI container. | planner (on-demand), implementer backend (on-demand), **architecture-reviewer (preload)**, **plan-viewer (preload)**, doc-writer (on-demand) |
| `fastify-best-practices` | Fastify 5: плагины, хуки, декораторы, схемы, SSE, типы. | planner (on-demand), implementer backend (on-demand), architecture-reviewer (on-demand), doc-writer (on-demand) |
| `drizzle-orm-patterns` | Drizzle ORM: queries, relations, transactions, migrations, data mappers. | planner (on-demand), implementer backend (on-demand), architecture-reviewer (on-demand), **test-writer (on-demand)**, doc-writer (on-demand) |
| `postgresql-table-design` | PostgreSQL: types, indexes, constraints, pgvector, performance patterns. | planner (on-demand), implementer backend (on-demand), architecture-reviewer (on-demand), **test-writer (on-demand)** |
| `zod` | Zod v4: schemas, safeParse, z.infer, coerce, refinements. | planner (on-demand), implementer backend+UI (on-demand), architecture-reviewer (on-demand), **test-writer (preload)**, doc-writer (on-demand) |
| `frontend-architecture` | WHERE код живёт в React 19 + Next.js 15: folder structure, feature org, colocation. | planner (preload), implementer UI (on-demand), architecture-reviewer (on-demand), **test-writer (on-demand)**, doc-writer (on-demand) |
| `next-best-practices` | Next.js 15 App Router: RSC, Server Actions, Route Handlers, caching, metadata. | planner (on-demand), implementer UI (on-demand), architecture-reviewer (on-demand), **test-writer (on-demand)**, doc-writer (on-demand) |
| `react-best-practices` | React 19: компоненты, хуки, state, performance, anti-patterns. | planner (on-demand), implementer UI (on-demand), architecture-reviewer (on-demand), **test-writer (on-demand)**, doc-writer (on-demand) |
| `react-testing-library` | RTL + Vitest: query priority, userEvent, async patterns, mocking. | implementer UI (on-demand, Phase 4), **test-writer (preload)** |
| `typescript-expert` | TypeScript: type-level programming, generics, utility types, strict mode. | implementer (preload, оба scope), **architecture-reviewer (preload)**, **test-writer (preload)** |
| `security` | OWASP Top 10: XSS, CSRF, injection, auth, secrets management. | implementer (preload, оба scope), **architecture-reviewer (preload)**, **test-writer (on-demand)** |
| `mermaid-diagram` | Mermaid: flowchart, sequence, classDiagram, ER, stateDiagram. | planner (preload, для диаграмм в планах), **doc-writer (preload)** |
| `engineering-insights` | Запись открытий и паттернов в `*/insights/INSIGHTS.md`. | implementer (on-demand, конец сессии) |
| `pr-self-review` | Оркестратор ревью: diff → buckets → sub-agents → merge gate. Официальный гейт. | implementer вызывает в конце на `git diff $START_SHA...HEAD` |

---

## Источники best practices

| Практика | Источник |
|----------|---------|
| Frontmatter reference: tools allowlist, skills preload, permissionMode, color | [Claude Code Docs — Sub-agents](https://code.claude.com/docs/en/sub-agents) |
| `Skill` нужно явно добавлять в tools allowlist для on-demand загрузки | [Claude Code Docs — Sub-agents](https://code.claude.com/docs/en/sub-agents) |
| `skills:` frontmatter = startup context (токены с turn 1); Skill tool = on-demand | [Claude API — Skill Authoring Best Practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) |
| Planner = read-only + structured artifact output, не разговор | [DEV.to — Designing Planner Sub-agents](https://dev.to/cristiansifuentes/conversational-development-with-claude-code-part-7-designing-sub-agents-for-planning-meet-1nlk) |
| `model: opus` для planner (planning = high-stakes reasoning) | [DEV.to — Designing Planner Sub-agents](https://dev.to/cristiansifuentes/conversational-development-with-claude-code-part-7-designing-sub-agents-for-planning-meet-1nlk) |
| 4-phase planner methodology: survey → clarify → plan → validate | [GitHub — affaan-m/everything-claude-code/planner.md](https://github.com/affaan-m/everything-claude-code/blob/main/agents/planner.md) |
| `model: sonnet` для implementer (execution дешевле planning) | [PubNub Blog — Best Practices for Claude Code Sub-agents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/) |
| Focused agents > general-purpose; один агент = одна ответственность | [PubNub Blog — Best Practices for Claude Code Sub-agents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/) |
| Description — маршрутизатор: trigger + exclusions + `<example>` теги | [PubNub Blog — Best Practices for Claude Code Sub-agents](https://www.pubnub.com/blog/best-practices-for-claude-code-sub-agents/) |
| U-shaped attention: роль сверху (2 предложения) + Rules снизу (повтор) | [Indie Hackers — Reverse-engineering Claude Code System Prompts](https://www.indiehackers.com/post/the-complete-guide-to-writing-agent-system-prompts-lessons-from-reverse-engineering-claude-code-6e18d54294) |
| Encode procedure (numbered steps), не motivation | [Indie Hackers — Reverse-engineering Claude Code System Prompts](https://www.indiehackers.com/post/the-complete-guide-to-writing-agent-system-prompts-lessons-from-reverse-engineering-claude-code-6e18d54294) |
| `<example>` теги в description улучшают точность делегирования | Паттерн из `.claude/agents/researcher.md` этого проекта |
| Interview Mode (STEP 0): оценка запроса до начала работы | Паттерн из `.claude/agents/researcher.md` этого проекта |
