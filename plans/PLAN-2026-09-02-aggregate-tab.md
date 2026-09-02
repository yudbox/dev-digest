# Plan: Aggregate tab (Multi-Agent Review)

> Status: DRAFT
> Created: 2026-09-02
> Spec: `specs/SPEC-2026-09-02-aggregate-tab.md`
> Execution Mode: **single-agent** (последовательно: контракты → backend → frontend)

---

## Requirements (VRF)

> Status: Confirmed (владелец подтвердил ответы Q1–Q3 + решения 1–11 из брифа)

| ID | Требование | Источник |
|----|-----------|----------|
| R1 | Переключатель режимов становится трёхпозиционным: `Columns` \| `Tabs` \| `Aggregate`, дефолт `Columns` | AC-1 |
| R2 | Режим `Aggregate` при пустом кеше не делает ни одного fetch — empty state + кнопка `Generate` | AC-2 |
| R3 | `Generate` шлёт ровно один `POST /multi-agent-runs/:id/aggregate`; кнопка disabled в pending; на месте таблицы лоадер | AC-3 |
| R4 | Таблица: `Severity`, `Category`, `File:Line`, `Finding`, `Cards`, `Reviewer Comment`; сортировка severity → file → start_line | AC-4, решение 11 |
| R5 | Данные только в TanStack Query cache по ключу `["multi-agent-aggregate", runId]`; переключение режимов не вызывает fetch; в БД ничего не пишется | AC-5, AC-26, решение 8 |
| R6 | `Regenerate` полностью заменяет содержимое кеша ответом сервера | AC-6 |
| R7 | На каждый источник группы — чип-ссылка `[↗ AgentName]` → `/repos/{repoId}/pulls/{pr_number}?tab=findings&finding={finding_id}` | AC-7, решение 9 |
| R8 | Иконка копирования пишет в буфер **только английскую часть** `reviewer_comment` + toast ≤1 c; нет `navigator.clipboard` → ошибка копирования | AC-8, решение 6 |
| R9 | Ошибка запроса → сообщение с текстом сервера + `Retry`; ранее полученный агрегат не затирается | AC-9 |
| R10 | Прогон без находок → «нет находок», кнопки `Generate` нет | AC-10 |
| R11 | Есть колонка `status === "running"` → `Generate` disabled + подсказка | AC-11 |
| R12 | Все строки новой вкладки — через `useTranslations()`; вывод LLM рендерится как текст, без `dangerouslySetInnerHTML` | AC-12, AC-13 |
| R13 | Сервер берёт находки только колонок со `status === "done"` | AC-14 |
| R14 | Пред-группировка: тот же `file` И пересечение `[start_line,end_line]` либо зазор ≤ **10** строк; разные файлы не объединяются никогда | AC-15 (порог переопределён решением 2) |
| R15 | Группы-кандидаты уходят в LLM как «возможные дубликаты»; правило: одна первопричина в одном месте = одна строка | AC-16 |
| R16 | Severity группы = максимум по источникам; category = категория источника с максимальной severity (при равенстве — первый по порядку) | AC-17 |
| R17 | Ответ содержит `title` + `reviewer_comment` от LLM и `sources[]` с идентификаторами каждой исходной находки | AC-18 |
| R18 | Grounding: неизвестный `finding_id` отбрасывается; дубль закрепляется за первой группой; пустая группа не попадает в ответ | AC-19 |
| R19 | `id` строки детерминирован от отсортированного набора `finding_id` источников | AC-20 |
| R20 | Один LLM-вызов на весь прогон, без батчинга; guard `> AGGREGATE_MAX_FINDINGS` → `422` без LLM-вызова | AC-21…AC-23 (переопределены решением 1) |
| R21 | Модель — через `resolveFeatureModelStrict`; не выбрана → `422` со ссылкой на Settings → Feature Models | AC-24, решение 4 |
| R22 | Ошибка/таймаут LLM → `502`, БД не меняется | AC-25 |
| R23 | `title`, `rationale`, `suggestion` каждой находки попадают в промпт только внутри `wrapUntrusted()` | AC-27 |
| R24 | Rate limit 10 запросов/мин на эндпоинт | AC-28 |
| R25 | Несуществующий прогон / чужой workspace → `404` | AC-29 |
| R26 | Промпт: явная JSON-схема + one-shot пример, «Return ONLY valid JSON, no markdown», правила группировки, `reviewer_comment` = EN, затем RU | решение 6 + требования к промпту |
| R27 | Валидация ответа LLM: мягкая схема в `completeStructured`, строгий `safeParse` поэлементно в сервисе; невалидные элементы молча отбрасываются; повтор — только вручную (`Regenerate`) | решения 3, 10 + Q2 |
| R28 | `FeatureModelId` **не переименовывается**; меняется только человекочитаемый label на «Standard Model» + hint «Используется: PR Review, Aggregate» | решение 4 + Q1 |
| R29 | Панель «Where Agents Disagree» не трогаем — видима во всех режимах | решение 7 |

---

## Open Questions & Recommendations

| # | Вопрос | Ответ | Тип |
|---|--------|-------|-----|
| Q1 | Контракт `AggregatedFinding`: краткий из брифа (`line: string`, `source_cards`) или полный из спеки (`id`, `start_line`/`end_line`, `sources[]`)? | Полный контракт спеки как транспорт; `"74-76"` собирается на клиенте чистой функцией `formatLineRange`. Без числового `start_line` ломается сортировка (AC-4), без `id` — AC-20 | gap (принят рекомендованный default) |
| Q2 | Батчинг + пороги (AC-21/22/23 vs решение 1) | Батчинга нет — один LLM-вызов. AC-21, AC-22 и NFR «≤3 параллельных вызова» помечены superseded. Вместо AC-23: guard `AGGREGATE_MAX_FINDINGS = 60` → 422 без LLM-вызова. Порог пред-группировки `AGGREGATE_LINE_GAP = 10` (перекрывает «5 строк» из AC-15) | 🚩 конфликт спеки и решения владельца |
| Q3 | Где граница между «молча отбросили» и 502? | 502 — только если LLM бросил/таймаут/не вернул JSON-объект нужной формы. 200 с частичным результатом — если часть элементов не прошла строгий `safeParse` или потеряла все источники при grounding. 200 с `groups: []` — валидный результат | 🚩 конфликт AC-25 и решений 3/10 |
| Q4 | `MockLLMProvider.completeStructured` валидирует фикстуру по переданной схеме и бросает → строгая схема делает partial recovery непроверяемым | Вариант A: в `completeStructured` уходит **мягкая** схема (`z.array(z.unknown())` внутри), строгий `safeParse` — поэлементно в сервисе | 🚩 red flag, снят |
| Q5 | Переименование `review_intent` → `standard_model` | Вариант A: id в коде и БД **не трогаем**. Меняем только label → «Standard Model» + hint в Settings. Причина: значение персистится в `settings.value` jsonb (ключ `feature_models`) и в свободном тексте `agents.feature_model_id` — переименование требует бэкфилла в двух местах, иначе у настроенных воркспейсов молча начнёт падать 422 | 💡 рекомендация принята |
| Q6 | Механизма `?finding=` на странице PR detail фактически нет (читаются только `tab` и `trace`) | Отдельная TASK-007: прочитать `?finding=` в `pulls/[number]/page.tsx` и прокинуть `targeted` до `FindingCard` (проп уже существует) | 🚩 скрытая работа, не описанная в спеке |
| Q7 | Куда класть i18n-ключи | Новый файл `client/messages/en/multiAgent.json`, неймспейс `multiAgent.aggregate.*`. Существующие хардкоды на странице multi-agent не трогаем (scope creep) | gap |
| Q8 | Утилита копирования в буфер | В репозитории нет ни одной — пишем инлайн в компоненте вкладки, общей утилиты не заводим (нет второго потребителя) | gap |
| Q9 | Разделитель EN/RU в `reviewer_comment` | Константа `REVIEWER_COMMENT_SEPARATOR = "\n\n---\n\n"` в обеих копиях контракта. Если разделителя в ответе нет — копируем весь текст (fallback, не ошибка) | 💡 рекомендация |
| Q10 | Режим выполнения | single-agent, последовательно: контракты → backend → frontend | — |

---

## Affected Modules

| Модуль | Путь | Тип изменения |
|--------|------|---------------|
| contracts (server) | `server/src/vendor/shared/contracts/observability.ts` | Modify |
| contracts (client, зеркало) | `client/src/vendor/shared/contracts/observability.ts` | Modify |
| backend: `reviews` | `server/src/modules/reviews/aggregate-helpers.ts`, `aggregate-prompt.ts`, `aggregate-service.ts` | Add |
| backend: `reviews` | `server/src/modules/reviews/routes.ts`, `constants.ts` | Modify |
| backend: DI | `server/src/platform/container.ts` | Modify (только если `ReviewService` собирается там же) |
| backend: `settings` | `server/src/modules/settings/feature-models.ts` | Modify (label) |
| frontend: hooks | `client/src/lib/hooks/reviews.ts` | Modify |
| frontend: страница | `client/src/app/repos/[repoId]/multi-agent-review/[runId]/page.tsx` | Modify |
| frontend: вкладка | `client/src/app/repos/[repoId]/multi-agent-review/[runId]/_components/AggregateTab/` | Add |
| frontend: i18n | `client/messages/en/multiAgent.json` + загрузчик сообщений | Add / Modify |
| frontend: PR detail | `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`, `_components/FindingsTab/`, `_components/FindingsPanel/` | Modify |
| frontend: Settings | `client/src/lib/utils/featureModels.ts`, `.../SettingsModels.tsx`, `client/messages/en/settings.json` | Modify |

---

## Tasks

### TASK-001: Контракты агрегации в обеих копиях `observability.ts`

**Scope:** both

**Owned Paths:**
- `server/src/vendor/shared/contracts/observability.ts`
- `client/src/vendor/shared/contracts/observability.ts`

Добавить рядом с `MultiAgentRun` (обе копии обновляются независимо — `@devdigest/shared` в клиенте резолвится в **свою** локальную копию):

- `AggregatedSourceSchema` — `finding_id`, `review_id`, `run_id`, `agent_id`, `agent_name`, `severity`, `file`, `start_line`
- `AggregatedFindingSchema` — `id`, `severity`, `category`, `file`, `start_line`, `end_line`, `title`, `reviewer_comment`, `sources: AggregatedSource[]` (`.min(1)`)
- `AggregateResponseSchema` — `multi_agent_run_id`, `generated_at`, `model`, `source_findings_total`, `groups: AggregatedFinding[]`
- `export const REVIEWER_COMMENT_SEPARATOR = "\n\n---\n\n";`
- Типы через `z.infer`, экспортируются и схема, и тип.

Стилевые отличия копий сохранить как есть: сервер — двойные кавычки и импорты с `.js`; клиент — одинарные кавычки и без `.js`.

**Acceptance Criteria:**
- [ ] AC-001: обе копии содержат три схемы + константу-разделитель и экспортируют inferred-типы (R17, R19)
- [ ] AC-002: `pnpm typecheck` проходит в `server/` и в `client/`
- [ ] AC-003: схемы семантически идентичны в обеих копиях (отличия только в кавычках и `.js` в импортах)

**Verification:**
| AC | Как измерить |
|----|--------------|
| AC-001 | чтение файлов; `z.infer` типы импортируются из `@devdigest/shared` в TASK-003 и TASK-005 без ошибок |
| AC-002 | `cd server && pnpm typecheck` → 0 ошибок; `cd client && pnpm typecheck` → 0 ошибок |
| AC-003 | `diff <(sed "s/'/\"/g; s/\.js'/'/g" client/src/vendor/shared/contracts/observability.ts) server/src/vendor/shared/contracts/observability.ts` — семантических расхождений нет |

---

### TASK-002: Чистые функции агрегации + константы + промпт

**Scope:** backend

**Owned Paths:**
- `server/src/modules/reviews/aggregate-helpers.ts` (новый)
- `server/src/modules/reviews/aggregate-prompt.ts` (новый)
- `server/src/modules/reviews/constants.ts`

**`constants.ts` — дописать (существующие `REVIEW_STRATEGY`, `MAX_FINDINGS_PER_REVIEW` не трогать):**
- `AGGREGATE_LINE_GAP = 10` — зазор пред-группировки в строках
- `AGGREGATE_MAX_FINDINGS = 60` — жёсткий guard (реальный потолок 5 агентов × `MAX_FINDINGS_PER_REVIEW` = 25)
- `AGGREGATE_FEATURE_MODEL_ID = "review_intent"` — переиспользуемый id фичи-модели (см. Q5)

**`aggregate-helpers.ts` — только чистые функции, без импортов Fastify/Drizzle/LLM:**
- `collectSourceFindings(run: MultiAgentRun): AggregatedSource[]` — плоский список находок колонок со `status === "done"`; колонки `failed`/`running` исключаются (R13)
- `preGroupFindings(sources, gap = AGGREGATE_LINE_GAP): AggregatedSource[][]` — группировка по `file` + пересечение диапазонов или зазор ≤ gap; разные файлы никогда не в одной группе (R14)
- `reconcileSeverity(sources): { severity, category }` — максимум severity (CRITICAL > WARNING > SUGGESTION), category источника с максимальной severity, при равенстве — первый по порядку (R16)
- `groupId(findingIds: string[]): string` — sha256 от отсортированного и склеенного через `,` набора id, hex, первые 16 символов (R19); `node:crypto` допустим — I/O нет
- `groundGroups(llmGroups, sources): AggregatedFinding[]` — заземление (R18):
  - `Map<finding_id, AggregatedSource>` по входным находкам;
  - неизвестный id отбрасывается;
  - уже использованный id отбрасывается (закрепляется за первой группой в порядке ответа);
  - **источники с `file`, отличным от `file` первого источника группы, отбрасываются** — межфайловое объединение запрещено (R14);
  - группа без источников не попадает в результат;
  - `file` = файл первого источника, `start_line` = min, `end_line` = max по источникам.

**`aggregate-prompt.ts`:**
- `AGGREGATE_SYSTEM_PROMPT` — правила: одна первопричина в одном месте кода = одна строка; различие формулировок не основание для разделения, различие первопричины — основание; вернуть **только** JSON, без markdown-обёртки; явная JSON-схема ответа; один one-shot пример вход→выход; `reviewer_comment` = сначала английский текст (для вставки в PR), затем разделитель `---`, затем русский пересказ; severity и category **не возвращать** — они считаются детерминированно на сервере (R26)
- `buildAggregateUserPrompt(groups: AggregatedSource[][], findingTexts): string` — каждая находка подаётся как `finding_id` + `file:line` (доверенные метаданные) и `title` / `rationale` / `suggestion`, **каждое поле обёрнуто `wrapUntrusted()`** из `server/src/platform/prompt.ts` (шим над `reviewer-core/src/prompt.ts`) (R23). Группы-кандидаты подаются помеченными как «возможные дубликаты» (R15)
- `LlmAggregateGroupSchema` — **строгая** поэлементная схема: `{ finding_ids: string[].min(1), title: string.min(1), reviewer_comment: string.min(1) }`
- `LlmAggregateResponseSchema` — **мягкая** схема для провайдера: `z.object({ groups: z.array(z.unknown()) })` (Q4)

**Acceptance Criteria:**
- [ ] AC-004: `preGroupFindings` кладёт кейс из SPIKE (`packages/contracts/constants.ts`, строки `10` и `7-10`) в одну группу; одинаковый title в разных файлах — в две (R14, AC-15)
- [ ] AC-005: `reconcileSeverity` для CRITICAL(security) + WARNING(bug) даёт `severity=CRITICAL`, `category=security` (R16, AC-17)
- [ ] AC-006: `groupId` детерминирован: два вызова на одинаковом наборе id (в разном порядке) дают одинаковую строку (R19, AC-20)
- [ ] AC-007: `groundGroups` отбрасывает выдуманный uuid, дубль id во второй группе и источник из другого файла; пустая группа не возвращается (R18, AC-19)
- [ ] AC-008: `collectSourceFindings` не возвращает находок колонок `failed`/`running` (R13, AC-14)
- [ ] AC-009: файлы не импортируют `fastify`, `drizzle-orm`, `../../db/*` и адаптеры

**Verification:**
| AC | Как измерить |
|----|--------------|
| AC-004…AC-008 | `cd server && pnpm exec vitest run src/modules/reviews/aggregate-helpers.test.ts` → passes (тесты пишутся в TASK-004) |
| AC-009 | grep импортов в обоих новых файлах — совпадений нет |

---

### TASK-003: Сервис агрегации + DI + HTTP-роут

**Scope:** backend

**Owned Paths:**
- `server/src/modules/reviews/aggregate-service.ts` (новый)
- `server/src/modules/reviews/routes.ts`
- `server/src/platform/container.ts`

**`aggregate-service.ts` — `AggregateService.aggregate(workspaceId, runId, log)`:**
1. `repo.getMultiAgentRunById(runId)`; `null` → `NotFoundError` (404). Проверка принадлежности workspace — **тем же приёмом, что в `ReviewService.getMultiAgentRun`**: загрузить PR через `repo.getPull(workspaceId, run.pr_id)`, при отсутствии → `NotFoundError` (R25, AC-29). Отдельный метод репозитория **не заводить** — `getMultiAgentRunById` уже возвращает колонки со `status` и полными `FindingRecord`.
2. `collectSourceFindings(run)`; пусто → вернуть `{ groups: [], source_findings_total: 0, ... }` **без LLM-вызова**.
3. `sources.length > AGGREGATE_MAX_FINDINGS` → `ValidationError` (422) с текстом про лимит, **до** любого обращения к LLM (R20, AC-23).
4. `resolveFeatureModelStrict(container, workspaceId, AGGREGATE_FEATURE_MODEL_ID)` — при отсутствии выбора сам бросит `ValidationError` (422) с текстом «choose one in Settings → Feature Models» (R21, AC-24). Дополнительный try/catch не нужен.
5. `preGroupFindings(sources)` → `buildAggregateUserPrompt(...)`.
6. `const llm = await container.llm(choice.provider)` → `llm.completeStructured({ model: choice.model, schema: LlmAggregateResponseSchema, schemaName: "AggregateGroups", messages: [system, user], temperature: 0.2, maxTokens: ... })`. **Весь вызов в try/catch → `ExternalServiceError`** (502; маппинг уже есть в `server/src/app.ts`) (R22, AC-25). Это новое для модуля: сейчас `reviews/*` нигде не бросает 502.
7. Поэлементно `LlmAggregateGroupSchema.safeParse(el)`; невалидные — `log.warn({ index }, "aggregate: dropped invalid LLM group")` и молча выбрасываются (R27, Q3).
8. `groundGroups(validGroups, sources)` + `reconcileSeverity` + `groupId` → `AggregatedFinding[]`.
9. Ответ: `multi_agent_run_id`, `generated_at: new Date().toISOString()`, `model: \`${choice.provider}/${choice.model}\``, `source_findings_total`, `groups`.
10. Ни одного INSERT/UPDATE/DELETE на всём пути (R5, AC-26).

**DI:** повторить приём, которым в модуле уже добывается `ReviewService` в `routes.ts`. Если `ReviewService` инстанцируется в `platform/container.ts` — там же инстанцировать `AggregateService`; если в плагине routes — так же. **`new` вне composition root не добавлять.** Проверить перед правкой: как `routes.ts` получает `service`.

**Роут в `routes.ts`** (namespace `/multi-agent-runs/:id/...` — обязателен, `/runs/:id/*` принадлежит `agent_runs`):
```
POST /multi-agent-runs/:id/aggregate
  schema: { params: IdParams }          // существующая схема модуля
  config: { rateLimit: { max: 10, timeWindow: "1 minute" } }   // AC-28
  handler: getContext → aggregateService.aggregate(workspaceId, req.params.id, req.log) → return
```
Хендлер — тонкий: валидация params, один вызов сервиса, отдача результата. Никакой бизнес-логики в роуте.

**Acceptance Criteria:**
- [ ] AC-010: `POST /multi-agent-runs/:id/aggregate` зарегистрирован, `config.rateLimit = { max: 10, timeWindow: "1 minute" }` (R24, AC-28)
- [ ] AC-011: несуществующий id или чужой workspace → 404 (R25, AC-29)
- [ ] AC-012: находок > 60 → 422, `MockLLMProvider.calls` пуст (R20, AC-23)
- [ ] AC-013: модель не выбрана → 422 с текстом про Settings (R21, AC-24)
- [ ] AC-014: LLM бросил → 502, снапшот таблиц до/после совпадает (R22, AC-25, AC-26)
- [ ] AC-015: успешный ответ соответствует `AggregateResponseSchema`, `sources[]` содержит `finding_id`, `review_id`, `run_id`, `agent_id`, `agent_name`, `severity` (R17, AC-18)
- [ ] AC-016: захваченный промпт содержит `<untrusted source=...>` вокруг `title`, `rationale`, `suggestion` каждой находки (R23, AC-27)
- [ ] AC-017: невалидный элемент массива не роняет запрос — остальные группы возвращаются, статус 200 (R27)
- [ ] AC-018: `service.ts`/`repository.ts` существующего модуля не изменены; новых методов репозитория нет

**Verification:**
| AC | Как измерить |
|----|--------------|
| AC-010 | чтение `routes.ts`; ручная проверка 429 после 11 запросов в production-режиме |
| AC-011, AC-012, AC-014 | `cd server && pnpm exec vitest run .it.test` → `aggregate.it.test.ts` passes |
| AC-013, AC-016, AC-017 | `cd server && pnpm exec vitest run src/modules/reviews/aggregate-service.test.ts` |
| AC-015 | `curl -X POST localhost:3001/multi-agent-runs/<uuid>/aggregate` → 200, форма ответа соответствует контракту |
| AC-018 | `git diff --stat server/src/modules/reviews/service.ts server/src/modules/reviews/repository.ts` → пусто |

---

### TASK-004: Серверные тесты агрегации

**Scope:** backend

**Owned Paths:**
- `server/src/modules/reviews/aggregate-helpers.test.ts` (новый)
- `server/src/modules/reviews/aggregate-service.test.ts` (новый)
- `server/src/modules/reviews/aggregate.it.test.ts` (новый)

- **Unit (герметичные)** — `aggregate-helpers.test.ts`: пред-группировка (кейс SPIKE: строки `10` и `7-10` → одна группа; тот же title в разных файлах → две группы), реконсиляция severity/category, детерминированный `groupId`, grounding (выдуманный uuid, дубль id, чужой файл, пустая группа), фильтр `status === "done"`.
- **Unit сервиса** — `aggregate-service.test.ts`: `MockLLMProvider` из `server/src/adapters/mocks.ts` инжектится через `container.overrides.llm`; проверки — перехват промпта (`mock.calls[0].req.messages`) на `wrapUntrusted` и на наличие правил группировки; фикстура с одним невалидным элементом → 200 с частичным результатом; отсутствие модели → `ValidationError`; бросок из провайдера → `ExternalServiceError`.
- **Интеграционный** — `aggregate.it.test.ts` (реальный Postgres, суффикс `.it.test.ts` обязателен; в модуле `reviews` это будет первый такой файл — паттерн брать из `server/src/modules/evals/evals.it.test.ts`): прогон с одной `failed`-колонкой → её находок нет в `sources`; 404 на чужой workspace; 422 при `> AGGREGATE_MAX_FINDINGS` с непустым, но не вызванным моком LLM; сравнение снапшота таблиц до/после запроса.

**Acceptance Criteria:**
- [ ] AC-019: unit-набор покрывает AC-14, AC-15, AC-17, AC-19, AC-20, AC-27 и проходит без сети и без БД
- [ ] AC-020: интеграционный набор покрывает AC-14, AC-23, AC-25, AC-26, AC-29
- [ ] AC-021: `MockLLMProvider.calls.length === 1` на успешном сценарии и `=== 0` на сценариях 422 (R20)

**Verification:**
| AC | Как измерить |
|----|--------------|
| AC-019, AC-021 | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts' src/modules/reviews` → passes |
| AC-020 | `cd server && pnpm exec vitest run .it.test` → passes (нужен Docker) |

---

### TASK-005: Клиентский хук агрегации

**Scope:** frontend

**Owned Paths:**
- `client/src/lib/hooks/reviews.ts`

Дописать два экспорта (существующие хуки не трогать):
- `useAggregateRun(runId)` — `useMutation({ mutationFn: () => api.post<AggregateResponse>(\`/multi-agent-runs/${runId}/aggregate\`, ...), onSuccess: (data) => qc.setQueryData(["multi-agent-aggregate", runId], data) })`. Именно мутация, а не `useQuery` — вызов платный и не должен стрелять на mount/focus/reconnect (зафиксировано в `client/insights/INSIGHTS.md`). Ошибки не глушить: `ApiError.message` уже несёт текст сервера (`body.error.message`) — он нужен для AC-9.
- `useAggregateCache(runId)` — чтение кеша по тому же ключу без запроса: `useQuery({ queryKey: ["multi-agent-aggregate", runId], queryFn: skipToken })`.
  **Перед реализацией проверить версию `@tanstack/react-query` в `client/package.json`**: `skipToken` доступен с v5.25. Если версия ниже — не изобретать `enabled:false` с фиктивным `queryFn`, а поднять состояние в `page.tsx` через `mutation.data` (страница остаётся смонтированной при переключении режимов) и зафиксировать отклонение в Architecture Notes.

Ключ строго `["multi-agent-aggregate", runId]` — не путать с существующими `["multi-agent-run", id]` (singular) и `["multi-agent-runs", params]` (plural).

**Acceptance Criteria:**
- [ ] AC-022: `useAggregateRun` не выполняет запрос при монтировании (R2, AC-2)
- [ ] AC-023: успешный ответ попадает в кеш по ключу `["multi-agent-aggregate", runId]`, повторный `Generate` полностью заменяет его (R5, R6)
- [ ] AC-024: `useAggregateCache` не инициирует сетевой запрос ни при каком рендере (R5)

**Verification:**
| AC | Как измерить |
|----|--------------|
| AC-022…AC-024 | покрываются RTL-тестами из TASK-006 (`fetch` замокан глобально в `client/src/test/setup.ts`, считаем число вызовов) |

---

### TASK-006: Вкладка Aggregate — UI, i18n, тесты

**Scope:** frontend

**Owned Paths:**
- `client/src/app/repos/[repoId]/multi-agent-review/[runId]/page.tsx`
- `client/src/app/repos/[repoId]/multi-agent-review/[runId]/_components/AggregateTab/` (новая папка: `AggregateTab.tsx`, `helpers.ts`, `AggregateTab.test.tsx`)
- `client/messages/en/multiAgent.json` (новый) + регистрация неймспейса в загрузчике сообщений next-intl

**`page.tsx`:**
- `type ViewMode = "columns" | "tabs" | "aggregate"`, третья кнопка в переключателе (не забыть про `borderRight` — сейчас он захардкожен под две кнопки), дефолт `columns` (R1)
- Хуки `useAggregateRun` / `useAggregateCache` вызываются **на уровне страницы** — так данные и pending переживают переключение режимов
- Ветка `{view === "aggregate" && <AggregateTab ... />}`
- `<WhereAgentsDisagree />` остаётся ниже, без условий — не трогаем (R29)

**`AggregateTab.tsx`** (`"use client"`, все строки через `useTranslations("multiAgent")`):
- Состояния: `нет находок` (сумма `columns[].findings.length === 0` → без кнопки, R10) → `есть running` (кнопка disabled + подсказка, R11) → `пустой кеш` (empty state + `Generate`, R2) → `pending` (лоадер на месте таблицы, кнопка disabled, R3) → `данные` (таблица + `Regenerate`, R4) → `ошибка` (сообщение из `error.message` + `Retry`, старая таблица остаётся, R9)
- Таблица: `Severity`, `Category`, `File:Line`, `Finding`, `Cards`, `Reviewer Comment`
- Ячейка `Cards`: по чипу `[↗ {agent_name}]` на каждый источник, `next/link` на `/repos/${repoId}/pulls/${run.pr_number}?tab=findings&finding=${source.finding_id}` (R7)
- Ячейка `Reviewer Comment`: текст + кнопка копирования; `splitReviewerComment(text).en` → `navigator.clipboard?.writeText`; успех → `notify.success`, отсутствие clipboard или reject → `notify.error` (toast из `client/src/lib/contexts/toast.tsx`) (R8)
- Только текстовый рендер, `dangerouslySetInnerHTML` запрещён (R12, AC-13)

**`helpers.ts`** (чистые функции, без React):
- `formatLineRange(start, end): string` — `"74"` при равенстве, иначе `"74-76"`
- `splitReviewerComment(text): { en: string; ru: string }` — split по `REVIEWER_COMMENT_SEPARATOR` из `@devdigest/shared`; разделителя нет → `{ en: text, ru: "" }` (Q9)
- `sortAggregated(groups)` — severity (CRITICAL→WARNING→SUGGESTION) → `file` лексикографически → `start_line` по возрастанию. **Сортировка живёт на клиенте** — этого требует observable AC-4 (перемешанный мок → детерминированный DOM)

**i18n:** новый файл `client/messages/en/multiAgent.json`, ключи `aggregate.*` (заголовки колонок, кнопки, состояния, тексты toast). Локаль в проекте одна — `en`. Загрузчик сообщений next-intl должен подхватить новый файл — найти его (место, где собирается объект `messages`) и зарегистрировать неймспейс; без этого `useTranslations("multiAgent")` упадёт в рантайме. Хардкоды существующих строк страницы multi-agent **не трогаем** — вне скоупа.

**Тесты `AggregateTab.test.tsx`:** обёртка `NextIntlClientProvider` (паттерн из `client/src/app/repos/[repoId]/onboarding/_components/*.test.tsx`) **плюс** `QueryClientProvider` — в этой директории тестов ещё нет, обёртку заводим здесь.

**Acceptance Criteria:**
- [ ] AC-025: три кнопки в переключателе, активна `Columns` (R1, AC-1)
- [ ] AC-026: клик по `Aggregate` при пустом кеше — `Generate` в DOM, `fetch` не вызван (R2, AC-2)
- [ ] AC-027: двойной клик по `Generate` → `fetch` вызван один раз; кнопка disabled в pending (R3, AC-3)
- [ ] AC-028: перемешанный мок → порядок строк в DOM детерминирован (severity → file → start_line) (R4, AC-4)
- [ ] AC-029: `Aggregate → Columns → Aggregate` → `fetch` вызван один раз (R5, AC-5)
- [ ] AC-030: `Regenerate` со вторым набором строк полностью вытесняет первый (R6, AC-6)
- [ ] AC-031: группа с N источниками рендерит ровно N чипов с корректным `href` (R7, AC-7)
- [ ] AC-032: клик по копированию вызывает `navigator.clipboard.writeText` **только с EN-частью** и показывает toast (R8, AC-8)
- [ ] AC-033: 500 на `Regenerate` → старая таблица на месте, сверху сообщение + `Retry` (R9, AC-9)
- [ ] AC-034: пустые `columns[].findings` → кнопки `Generate` нет (R10, AC-10)
- [ ] AC-035: колонка `status="running"` → кнопка disabled + подсказка (R11, AC-11)
- [ ] AC-036: `"<img src=x onerror=alert(1)>"` в `reviewer_comment` отображается как текст, `img` в DOM нет (R12, AC-13)
- [ ] AC-037: в JSX вкладки нет строковых литералов, все ключи присутствуют в `messages/en/multiAgent.json` (R12, AC-12)

**Verification:**
| AC | Как измерить |
|----|--------------|
| AC-025…AC-036 | `cd client && pnpm test src/app/repos/\[repoId\]/multi-agent-review` → passes |
| AC-037 | grep по `AggregateTab.tsx` на строковые литералы в JSX + сверка ключей с `multiAgent.json`; ручная проверка страницы |

---

### TASK-007: Deep-link `?finding=` на странице PR detail

**Scope:** frontend

**Owned Paths:**
- `client/src/app/repos/[repoId]/pulls/[number]/page.tsx`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/`
- `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/`

Механизма нет: `page.tsx` читает только `tab` и `trace`. Подсветка существует на уровне `FindingCard` — проп `targeted` (→ `setExpanded(true)` + `scrollIntoView`) и DOM-якорь `data-finding-id={f.id}`, но никто его не прокидывает.

- `page.tsx`: `const targetFindingId = search.get("finding")`; если параметр есть, а `tab` не задан — активной вкладкой считать `findings`
- Прокинуть `targetFindingId` через `FindingsTab` → `FindingsPanel` → `FindingCard targeted={f.id === targetFindingId}`
- Hash-якоря **не добавлять** (явный non-goal спеки)
- `FindingCard.tsx` не изменять — проп уже есть

**Acceptance Criteria:**
- [ ] AC-038: переход по `/repos/{repoId}/pulls/{number}?tab=findings&finding={id}` открывает вкладку Findings и раскрывает/скроллит нужную карточку (R7, AC-7)
- [ ] AC-039: несуществующий `finding` в URL не ломает страницу — просто никто не подсвечен (edge case спеки: находка удалена/dismissed)
- [ ] AC-040: URL без `?finding=` ведёт себя ровно как раньше

**Verification:**
| AC | Как измерить |
|----|--------------|
| AC-038, AC-039 | RTL-тест `FindingsPanel`/`FindingsTab` с пропом + ручная проверка перехода из вкладки Aggregate |
| AC-040 | `cd client && pnpm test src/app/repos/\[repoId\]/pulls` → существующие тесты зелёные |

---

### TASK-008: Label «Standard Model» + hint в Settings

**Scope:** both

**Owned Paths:**
- `server/src/modules/settings/feature-models.ts`
- `client/src/lib/utils/featureModels.ts`
- `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsModels.tsx`
- `client/messages/en/settings.json`

- Строковый id `review_intent` **нигде не меняется** — ни в `FeatureModelId`, ни в `settings.value` jsonb, ни в `agents.feature_model_id`. Миграций и бэкфилла нет (Q5)
- В `FEATURE_MODELS` сервера поменять `label` на `"Standard Model"` — тот же label автоматически попадёт в текст 422 из `resolveFeatureModelStrict`
- То же отображаемое имя на клиенте + hint «Используется: PR Review, Aggregate» через ключ в `settings.json` (i18n, не хардкод)

**Acceptance Criteria:**
- [ ] AC-041: в Settings → Feature Models строка называется «Standard Model» и показывает hint про PR Review + Aggregate (R28)
- [ ] AC-042: 422 при невыбранной модели содержит «Standard Model» (R21, AC-24)
- [ ] AC-043: `grep -r "review_intent"` — набор совпадений не изменился (id не переименован, dead-полей нет)

**Verification:**
| AC | Как измерить |
|----|--------------|
| AC-041 | ручная проверка страницы Settings; ключ присутствует в `messages/en/settings.json` |
| AC-042 | `cd server && pnpm exec vitest run src/modules/settings` → passes |
| AC-043 | `git diff` по обеим копиям `contracts/platform.ts` → пусто |

---

## Implementation Phases

> ⚙️ Режим выполнения: **single-agent**, строго последовательно. Порядок обязателен: контракты нужны и серверу, и клиенту; клиентские RTL-тесты опираются на форму ответа, зафиксированную в TASK-001.

### Phase 0: DB / Schema

- [ ] Изменений схемы нет. `pnpm db:generate` / `pnpm db:migrate` **не запускать** — фича ничего не пишет и ничего не добавляет в схему (AC-26)

### Phase 1: Контракты (TASK-001)

- [ ] `server/src/vendor/shared/contracts/observability.ts` — `AggregatedSource`, `AggregatedFinding`, `AggregateResponse`, `REVIEWER_COMMENT_SEPARATOR`
- [ ] `client/src/vendor/shared/contracts/observability.ts` — зеркальная копия (одинарные кавычки, импорты без `.js`)
- [ ] `cd server && pnpm typecheck` && `cd client && pnpm typecheck`

### Phase 2: Backend (TASK-002, TASK-003)

- [ ] `modules/reviews/constants.ts` — `AGGREGATE_LINE_GAP`, `AGGREGATE_MAX_FINDINGS`, `AGGREGATE_FEATURE_MODEL_ID`
- [ ] `modules/reviews/aggregate-helpers.ts` — пред-группировка, реконсиляция, `groupId`, grounding
- [ ] `modules/reviews/aggregate-prompt.ts` — системный промпт, сборка user-промпта с `wrapUntrusted`, мягкая и строгая Zod-схемы
- [ ] `modules/reviews/aggregate-service.ts` — оркестрация: repo → guard → feature model → LLM → safeParse → grounding
- [ ] `platform/container.ts` — DI новой сервисной зависимости (только если `ReviewService` собирается там же; иначе повторить приём из `routes.ts`)
- [ ] `modules/reviews/routes.ts` — `POST /multi-agent-runs/:id/aggregate` с `rateLimit 10/min`
- [ ] `cd server && pnpm typecheck`

### Phase 3: Серверные тесты (TASK-004)

- [ ] `aggregate-helpers.test.ts` — герметичные unit
- [ ] `aggregate-service.test.ts` — `MockLLMProvider` через `container.overrides.llm`
- [ ] `aggregate.it.test.ts` — реальный Postgres (первый `.it.test.ts` в модуле)
- [ ] `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` → зелёный
- [ ] `cd server && pnpm exec vitest run .it.test` → зелёный

### Phase 4: Frontend (TASK-005, TASK-006)

- [ ] `src/lib/hooks/reviews.ts` — `useAggregateRun`, `useAggregateCache` (проверить наличие `skipToken` в установленной версии TanStack Query)
- [ ] `messages/en/multiAgent.json` + регистрация неймспейса в загрузчике next-intl
- [ ] `_components/AggregateTab/helpers.ts` — `formatLineRange`, `splitReviewerComment`, `sortAggregated`
- [ ] `_components/AggregateTab/AggregateTab.tsx` — состояния, таблица, чипы, копирование
- [ ] `multi-agent-review/[runId]/page.tsx` — третий режим в переключателе, ветка рендера
- [ ] `_components/AggregateTab/AggregateTab.test.tsx` — RTL с `NextIntlClientProvider` + `QueryClientProvider`

### Phase 5: Deep-link + Settings (TASK-007, TASK-008)

- [ ] `pulls/[number]/page.tsx` — чтение `?finding=`, дефолтная вкладка `findings`
- [ ] `FindingsTab` / `FindingsPanel` — прокидка `targeted` до `FindingCard`
- [ ] `settings/feature-models.ts` + `lib/utils/featureModels.ts` + `SettingsModels.tsx` + `messages/en/settings.json` — «Standard Model» и hint

### Phase 6: Приёмка

- [ ] `cd server && pnpm typecheck` && `cd client && pnpm typecheck`
- [ ] `cd client && pnpm test` → зелёный
- [ ] Ручной сквозной прогон: `./scripts/dev.sh` → multi-agent run → `Aggregate` → `Generate` → чип → карточка на PR detail → копирование комментария

---

## Risks & Mitigations

| Риск | Митигация |
|------|-----------|
| LLM возвращает `finding_id`, которых не было, или сливает находки из разных файлов | Grounding обязателен и отбрасывает неизвестные id, дубли и источники из чужого файла (TASK-002, AC-007) |
| Строгая схема в `completeStructured` уронит весь ответ из-за одного мусорного элемента | Мягкая схема провайдеру + строгий поэлементный `safeParse` в сервисе (Q4); тест на частичное восстановление обязателен |
| Порог `AGGREGATE_LINE_GAP = 10` и лимит `60` — неизмеренные догадки (зафиксировано в `server/insights/INSIGHTS.md`) | Обе величины — именованные константы в одном файле; калибровать после первого реального прогона, а не хардкодить по месту |
| Забыть вторую копию контракта → рантайм-рассинхрон клиента и сервера | Phase 1 идёт отдельно и заканчивается `typecheck` в обоих пакетах; AC-003 сверяет копии |
| `skipToken` отсутствует в установленной версии TanStack Query | Проверка версии — обязательный шаг TASK-005; fallback — состояние мутации на уровне `page.tsx`, отклонение фиксируется в Architecture Notes |
| Новый неймспейс next-intl не зарегистрирован → падение вкладки в рантайме | Явный чек-пункт в Phase 4; RTL-тест рендерит вкладку через `NextIntlClientProvider` с реальным JSON |
| Скоуп-крип: соблазн переписать хардкоженные строки всей страницы multi-agent на `t()` | AC-12 применяется **только** к новой вкладке; остальное — Out of Scope |
| Первый `.it.test.ts` в модуле `reviews` — нет локального паттерна | Брать паттерн из `server/src/modules/evals/evals.it.test.ts`; для запуска нужен Docker |

---

## Out of Scope

- Сохранение агрегата в БД, новые таблицы, миграции, новые поля (явный non-goal спеки)
- Автоматическая агрегация при открытии страницы или по завершении прогона; инвалидация при появлении новых находок
- Батчинг находок и параллельные LLM-вызовы (AC-21, AC-22 и NFR «≤3 параллельных вызова» — **superseded** решением владельца 1)
- Порог склейки «5 строк» из AC-15 — **superseded** значением 10 (решение 2)
- Лимит «300 находок» из AC-23 — **superseded** значением `AGGREGATE_MAX_FINDINGS = 60`
- Переименование `FeatureModelId` `review_intent` и любой бэкфилл данных (Q5)
- Изменение поведения вкладок `Columns`/`Tabs` и панели «Where Agents Disagree»
- Исправление `isSameLocation()` / `computeConflicts()` в существующей панели конфликтов
- Публикация комментария в GitHub/ADO прямо из вкладки (только копирование в буфер)
- Hash-якоря `#finding-<id>` на странице PR detail
- Перевод существующих хардкоженных строк страницы multi-agent на `useTranslations()`
- Колонка/бейдж консенсуса («2/4») — достаточно количества чипов в `Cards`
- Локаль `ru` в next-intl: русский текст приходит из вывода LLM, а не из i18n-файлов
- Требования доступности (A11y) — вне скоупа проекта

---

## Architecture Notes

**Onion-слои в модуле `reviews`.** Новый код не размывает границы:
- `aggregate-helpers.ts`, `aggregate-prompt.ts` — чистые трансформации; ноль импортов Fastify, Drizzle, адаптеров. Здесь живут пред-группировка, реконсиляция severity, `groupId` и grounding.
- `aggregate-service.ts` — application-слой: репозиторий + `resolveFeatureModelStrict` + `container.llm()`. Никакого SQL, никакого `new` адаптеров.
- `routes.ts` — presentation: `IdParams` → один вызов сервиса → ответ. Ветвлений и бизнес-правил в хендлере нет.
- `container.ts` — единственная точка сборки, если `ReviewService` собирается там же.

**Репозиторий не расширяем.** `repo.getMultiAgentRunById(id)` уже отдаёт `MultiAgentRun` с колонками, их `status` и полными `FindingRecord`, а проверка workspace делается через `repo.getPull(workspaceId, run.pr_id)` — ровно как в `ReviewService.getMultiAgentRun`. Никаких N+1: один вызов репозитория на запрос. Фильтр `status === "done"` (AC-14) — чистая функция, не SQL.

**Severity/category считает сервер, не LLM.** Модель возвращает только `finding_ids`, `title`, `reviewer_comment`. Всё остальное (`severity`, `category`, `file`, `start_line`, `end_line`, `id`) выводится детерминированно из источников. Это сокращает поверхность галлюцинаций и делает AC-17/AC-20 тестируемыми без LLM.

**Валидация — стек, без дублирования.** HTTP-форма (`IdParams`) — в `routes.ts`; лимит числа находок и наличие модели — предусловия сервиса (`ValidationError` → 422); недоверенный вывод LLM — строгий `safeParse` поэлементно в сервисе; доменный инвариант «источники группы из одного файла» — guard внутри `groundGroups`, без Zod.

**Коды ошибок.** 404 — `NotFoundError`; 422 — `ValidationError` (лимит находок, невыбранная модель); 502 — `ExternalServiceError` вокруг LLM-вызова; маппинг уже реализован в `server/src/app.ts`. Важно: 502 из модуля `reviews` раньше не бросался никогда — текущий пайплайн деградирует в `failed` agent_run. Для синхронного HTTP-эндпоинта агрегации это осознанно другое поведение (AC-25).

**Клиентское состояние.** Мутация (`useAggregateRun`) для платного явного действия + `setQueryData` в общий кеш; чтение — `useQuery` со `skipToken`, чтобы вкладка перерисовывалась на обновление кеша и при этом не могла инициировать запрос. Оба хука вызываются в `page.tsx`, а не внутри вкладки, — тогда `isPending` и данные переживают переключение режимов. Кеш TanStack Query не персистится, поэтому после перезагрузки страница честно возвращается в состояние AC-2.

**Сортировка — на клиенте.** Observable AC-4 («перемешанный мок → детерминированный DOM») требует, чтобы порядок задавал клиент. Сервер возвращает группы в порядке grounding; вторая сортировка на сервере не добавляется, чтобы не иметь двух источников правды.

**Двуязычный `reviewer_comment`.** Одно поле формата `EN` + `REVIEWER_COMMENT_SEPARATOR` + `RU`; разделитель — экспортируемая константа контракта, а не магическая строка в компоненте. Копируется только EN-часть; при отсутствии разделителя копируется весь текст (fallback, не ошибка).

**Безопасность.** Тексты находок производны от diff и описания PR, то есть недоверенны: в промпт они попадают только внутри `wrapUntrusted()` (формат `<untrusted source="...">…</untrusted>` с экранированием закрывающего тега), а вывод модели рендерится исключительно как текст.
