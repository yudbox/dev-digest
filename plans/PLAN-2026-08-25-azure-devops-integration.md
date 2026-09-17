# План: Интеграция Azure DevOps как второго VCS-провайдера

> Status: DRAFT
> Created: 2026-08-25
> Spec: [specs/SPEC-2026-08-25-azure-devops-integration.md](../specs/SPEC-2026-08-25-azure-devops-integration.md)
> Related: [AZURE_DEVOPS_ASSESSMENT.md](../../AZURE_DEVOPS_ASSESSMENT.md) — первичная оценка (менее точна, спека приоритетнее)
> Execution Mode: **single-agent** — один implementer ведёт все фазы последовательно, включая UI

---

## Requirements (VRF)

> Status: Confirmed (все 56 AC переформулированы и подтверждены владельцем)

| ID | Требование | Источник |
|---|---|---|
| R1 | `parseRepoUrl` для github.com (https+ssh) не меняет поведения; пишет `vcs_provider='github'` | AC-1 |
| R2 | Парсер `dev.azure.com/{org}/{project}/_git/{repo}` и `{org}.visualstudio.com/...` → `{org, project, repo, baseUrl}` | AC-2 |
| R3 | Неизвестный хост → код `provider_required` (не `invalid_repo_url`); форма раскрывает dropdown + `baseUrl` | AC-3 |
| R4 | Ручной выбор `azure-devops` → `baseUrl` обязателен, путь парсится относительно него | AC-4 |
| R5 | Колонка `repos.vcs_provider` NOT NULL DEFAULT `'github'`; миграция бэкфиллит | AC-5 |
| R6 | Уникальность репо = `(workspace_id, vcs_provider, full_name)` | AC-6 |
| R7 | ADO-URL без `_git` / без трёх уровней → ошибка с примером формата | AC-7 |
| R8 | Порт `VcsClient` с `readonly id: 'github'\|'azure-devops'` по образцу `LLMProvider` | AC-8 |
| R9 | `Container.vcs(repo)` диспетчеризует по `repo.vcsProvider`; единственная точка конструирования | AC-9 |
| R10 | `RepoRef` = `{owner, name, project?, baseUrl?}`; Octokit игнорирует новые поля | AC-10 |
| R11 | ADO-адаптер без `project` бросает configuration-error **до** сетевого вызова | AC-11 |
| R12 | Неподдерживаемый метод → `not_supported` с `id` провайдера и именем метода | AC-12 |
| R13 | CI-эндпоинты для ADO-репо → 4xx `ci_not_supported_for_provider` | AC-13 |
| R14 | `SecretKey` += `AZURE_DEVOPS_TOKEN`; читается только через `SecretsProvider` | AC-14 |
| R15 | `ConnTestProvider` и `SecretsStatus` += `azure-devops` | AC-15 |
| R16 | Test-connection: Basic auth (пустой username + PAT), профильный эндпоинт → `ok` + message | AC-16 |
| R17 | Клиентский валидатор формата PAT (84 симв., `AZDO` в поз. 76–80) — **неблокирующее** предупреждение | AC-17 |
| R18 | PAT никогда не возвращается API — только маска | AC-18 |
| R19 | Маппинг ADO PR → `PrMeta` (`pullRequestId`, состояния, `refs/heads/` стрип, `lastMergeSourceCommit`, `createdBy`) | AC-19 |
| R20 | `additions/deletions/files_count` = 0 в списке; добираются существующим backfill в detail | AC-20 |
| R21 | Файлы через `iterations/{latest}/changes`, `$top ≤ 2000`, пагинация до `nextTop/nextSkip == 0` | AC-21 |
| R22 | `PrFile.additions/deletions` для ADO — из локального diff; нет diff → 0 | AC-22 |
| R23 | `Closes #N` в ADO PR → шаг linked-issue пропускается без ошибки | AC-23 |
| R24 | **`PrFile.patch` для ADO = реальный unified diff из `container.git.diff(base, head)`**, нарезанный по файлам | AC-24 |
| R25 | detail-путь `pulls` переводится на diff-first порядок (git diff → fallback API patch) | AC-25 |
| R26 | Перед diff — гарантия наличия base/head в клоне (fetch по provider-специфичному refspec) | AC-26 |
| R27 | Нет клона/коммитов → `patch=null` + явный признак недоступности с причиной; UI показывает сообщение | AC-27 |
| R28 | Сплиттер выдаёт patch в GitHub-формате: начинается с `@@`, без `diff --git` | AC-28 |
| R29 | `PrDetail` для ADO валидируется тем же Zod-контрактом; никаких новых **обязательных** полей | AC-29 |
| R30 | Публикация в ADO PR — **только** по явному клику; прогон агентов не создаёт тредов | AC-30 |
| R31 | Публикация находки = `POST threads` с `threadContext` + `properties['devdigest.findingId']` | AC-31 |
| R32 | `findingId` — детерминированный хэш от (repo, PR number, path, line, severity, title) | AC-32 |
| R33 | Тред с тем же `devdigest.findingId` → PATCH комментария, не новый тред | AC-33 |
| R34 | Свободный комментарий → новый тред без property идемпотентности | AC-34 |
| R35 | `GET threads` → плоский `PrReviewComment[]`; фильтр `commentType != 'text'` и удалённых | AC-35 |
| R36 | `PrReviewComment.thread_id` опционален (GitHub — `null`); `in_reply_to` для ADO = id треда | AC-36 |
| R37 | `html_url` = `{baseUrl}/{org}/{project}/_git/{repo}/pullrequest/{id}?discussionId={threadId}` | AC-37 |
| R38 | При наличии `changeTrackingId` — использовать его при позиционировании треда | AC-38 |
| R39 | Ошибка одного комментария локальна; опубликованные не откатываются; ретрай идемпотентен | AC-39 |
| R40 | Атомарный `postReview`-путь не применяется к ADO; N находок = N POST threads | AC-40 |
| R41 | Git-auth PAT-ом так, чтобы PAT не оседал в `.git/config` и git-истории | AC-41 |
| R42 | Убрать литерал `https://github.com/${fullName}.git`; clone URL из `vcs_provider + base_url + id` | AC-42 |
| R43 | PAT обоих провайдеров не попадает в логи, включая логи ошибок и retry | AC-43 |
| R44 | 429 (TSTU / `TF400733`) → ретрай по `Retry-After`, ≤3 повторов, ≤60с, затем `vcs_rate_limited` | AC-44 |
| R45 | Логировать `X-RateLimit-Remaining` / `X-RateLimit-Delay` (без PAT) | AC-45 |
| R46 | ADO-retry — надстройка **над** `withRetry`, не форк; GitHub-путь не тронут | AC-46 |
| R47 | 401/403 → `vcs_unauthorized` + подсказка о scope, без парсинга текста | AC-47 |
| R48 | Не-JSON ответ (HTML логина, часто 203) → `vcs_unauthorized`, не пустой успех | AC-48 |
| R49 | Список репозиториев показывает метку провайдера | AC-49 |
| R50 | Settings: поле Azure DevOps PAT + кнопка Test connection | AC-50 |
| R51 | Форма добавления репо: автоопределение провайдера до сабмита; неизвестный хост → dropdown + `baseUrl` | AC-51 |
| R52 | Deep-links диспетчеризуются по провайдеру; убрать захардкоженный `https://github.com` | AC-52 |
| R53 | Диспетчеризация на уровне репозитория, без глобального режима | AC-53 |
| R54 | Существующий suite зелёный после рефакторинга порта, без смягчения ассертов | AC-54 |
| R55 | Обобщённый `MockVcsClient` с `id`; существующие тесты с mock GitHub-клиентом не правятся | AC-55 |
| R56 | После миграции старые строки `repos` работают: `vcs_provider='github'`, `project=null`, `base_url=null` | AC-56 |

---

## Open Questions & Recommendations

> Разрешены на этапе VRF. Все ответы подтверждены владельцем проекта до начала планирования.

| # | Вопрос / рекомендация | Ответ | Тип |
|---|---|---|---|
| Q1 | Сигнатура метода публикации вместо `postReview` (открытый вопрос №1 спеки) | `publishComment(repoRef, prNumber, input): Promise<PrReviewComment>` — один комментарий за вызов. GitHub-реализация внутри использует свой inline-путь, ADO — threads. `postReview` уходит из порта в приватную деталь Octokit-реализации | gap |
| Q2 | Выделять ли `CiProvider` отдельным портом (открытый вопрос №4) | **Нет.** Вариант (c) — отложить. CI-методы остаются на `VcsClient`, ADO бросает `not_supported`, роуты `ci/` возвращают `ci_not_supported_for_provider`. Долг зафиксирован в Architecture Notes | 💡 рекомендация |
| Q3 | Один `AZURE_DEVOPS_TOKEN` на workspace vs PAT на репозиторий (открытый вопрос №3) | **Один PAT на workspace.** Совпадает с Out of scope #5 и текущей моделью `GITHUB_TOKEN` | gap |
| Q4 | Как выражается «дифф недоступен» в контракте (конфликт AC-27 ↔ AC-29) | Опциональное поле уровня `PrDetail`: `diff_unavailable?: { reason: 'clone_missing' \| 'clone_in_progress' \| 'commits_missing' \| 'diff_failed' }`. Опциональное ⇒ AC-29 не нарушается; enum ⇒ клиент локализует через `next-intl` без парсинга текста | gap |
| R-A | Refspec для head-коммита ADO PR (открытый вопрос №5) не подтверждён и лежит на критическом пути | **Спайк TASK-000**, гейтящий фазы 3 (D/E). Подтверждено записью `server/insights/INSIGHTS.md:179` | 🚩 red flag |
| R-B | diff-first загрузчик живёт в `reviews/diff-loader.ts`, нужен модулю `pulls` | Вынести в `server/src/modules/_shared/diff/`, перевести на него оба модуля. Прямой импорт `pulls → reviews` — нарушение границ модулей | 💡 рекомендация |
| R-C | Пороги ретраев (3 / 60с) помечены как «конфигурируемые» | Константы модуля адаптера (`adapters/azure-devops/constants.ts`), не `AppConfig` | 💡 рекомендация |
| R-D | `changeTrackingId` в ADO живёт не в `threadContext` | Использовать `pullRequestThreadContext.{changeTrackingId, iterationContext}`; при недоступности id итераций — graceful degradation до чистого `threadContext` | 💡 рекомендация |
| R-E | Спека требует реальный ADO-проект («mock-тестов недостаточно») | Реальная организация + репозиторий + PR **есть у владельца**. E2E-верификация на реальных данных заложена в TASK-000 и TASK-012 | 🚩 red flag |

---

## 🚩 Отклонения от предложенного порядка фаз

Одно осознанное отклонение от порядка, заданного в постановке задачи:

**Группа G (клонирование + git-auth) перенесена ВПЕРЁД — перед D/E, а не после F.**

Причина — жёсткая техническая зависимость: критичный diff-path группы E (R24, R26) вычисляет `patch` через `container.git.diff()` по **локальному клону**. Склонировать ADO-репозиторий без PAT-аутентификации в clone URL невозможно (`repos/service.ts:121` сегодня жёстко собирает `https://github.com/${fullName}.git`). Если оставить G после F, фаза E физически не сможет быть проверена — все ADO PR деградируют в `patch: null`, и AC-24/AC-25/AC-27 останутся неверифицируемыми до самого конца проекта.

Итоговый порядок: **B/C/A + схема → G → D+E → F → H/I → J → сквозная регрессия.**
Группа K (регрессия GitHub) остаётся сквозным требованием на каждой фазе, как и было задано.

---

## 🚩 Обнаруженные при ресёрче проблемы, которых нет в спеке

Три факта из обследования кодовой базы, которые меняют объём работ и не отражены в спеке. Каждый разведён по конкретным задачам ниже.

**P1 — Клиентский `@devdigest/shared` это НЕ алиас на сервер.**
`client/tsconfig.json` резолвит `@devdigest/shared` в **собственную локальную копию** `client/src/vendor/shared/`. Источник: `client/insights/INSIGHTS.md:56` (запись явно помечает `client/CLAUDE.md` и `client/insights/gotchas.md` как устаревшие и неверные в этом пункте). Следствие: **каждое** изменение контракта (`RepoRef`, `Repo`, `PrDetail.diff_unavailable`, `PrReviewComment.thread_id`, `ConnTestProvider`, `SecretsStatus`) нужно вносить **в двух файлах**, иначе клиент не соберётся или молча разойдётся с сервером.

**P2 — Коллизия путей клонов между провайдерами.**
`SimpleGitClient.clonePathFor(repo)` = `join(cloneDir, repo.owner, repo.name)` (`adapters/git/simple-git.ts:38`). В пути нет сегмента провайдера. AC-6 явно разрешает существование `github:acme/api` и `ado:acme/api` в одном workspace — их клоны попадут в **один и тот же каталог** и затрут друг друга. Спека этого не покрывает. Решается в TASK-005.

**P3 — Нулевое тестовое покрытие в зонах основного рефакторинга.**
В `server/src/modules/repos/`, `server/src/adapters/` — **ноль** тестовых файлов. В `server/src/modules/pulls/` — только `classifier.test.ts`, который GitHub не трогает. То есть AC-54 («базовая линия фиксируется до рефакторинга») сегодня фиксировать не на чем: рефакторинг `GitHubClient → VcsClient` затрагивает именно эти каталоги и не защищён ничем. Характеризационные тесты добавляются в TASK-000 **до** первого изменения кода.

---

## Affected Modules

| Модуль | Путь | Тип изменения |
|---|---|---|
| contracts (server) | `server/src/vendor/shared/adapters.ts` | Modify — `RepoRef`, `VcsClient`, `SecretKey`, `GitClient` |
| contracts (server) | `server/src/vendor/shared/contracts/platform.ts` | Modify — `Repo`, `PrDetail`, `PrReviewComment`, `ConnTestProvider`, `SecretsStatus` |
| contracts (client) | `client/src/vendor/shared/` | Modify — зеркальная копия (см. P1) |
| adapters: github | `server/src/adapters/github/octokit.ts` | Modify — реализует `VcsClient`, `readonly id = 'github'` |
| adapters: azure-devops | `server/src/adapters/azure-devops/` | **Add** — новая директория |
| adapters: mocks | `server/src/adapters/mocks.ts` | Modify — `MockVcsClient` + алиас совместимости |
| adapters: git | `server/src/adapters/git/simple-git.ts` | Modify — provider-aware `clonePathFor`, `fetchPullHead` |
| platform | `server/src/platform/container.ts` | Modify — `vcs(repo)` вместо `github()` |
| platform | `server/src/platform/resilience.ts` | Modify — экспорт для надстройки ADO-retry (сам `withRetry` не меняется) |
| db | `server/src/db/schema/repos.ts` + `server/src/db/migrations/0025_*.sql` | Modify + Add |
| modules: _shared | `server/src/modules/_shared/diff/` | **Add** — вынесенный diff-first загрузчик |
| modules: repos | `server/src/modules/repos/` | Modify — все 5 файлов |
| modules: pulls | `server/src/modules/pulls/routes.ts` | Modify — detail-путь + comments-роуты |
| modules: reviews | `server/src/modules/reviews/diff-loader.ts` | Modify — переезд в `_shared`, реэкспорт |
| modules: ci | `server/src/modules/ci/service.ts` | Modify — guard `ci_not_supported_for_provider` |
| modules: settings | `server/src/modules/settings/constants.ts` | Modify — `SECRET_KEY_BY_PROVIDER` |
| client: utils | `client/src/lib/utils/githubUrls.ts` → `vcsUrls.ts` | Modify/Rename |
| client: onboarding | `client/src/app/onboarding/_components/AddRepoView/` | Modify |
| client: settings | `client/src/app/settings/[section]/.../SettingsApiKeys/` | Modify |
| client: dashboard | `client/src/app/page.tsx` | Modify — provider badge |

---

## Tasks

### TASK-000: Спайк refspec + характеризационная база

**Scope:** backend (исследование + тесты, продуктового кода не пишем)

**Owned Paths:**
- `server/src/modules/repos/repos.characterization.it.test.ts` (новый)
- `server/src/modules/pulls/pulls-detail.characterization.it.test.ts` (новый)
- `server/src/adapters/azure-devops/SPIKE-NOTES.md` (временный, удаляется в TASK-006)

**Что делаем:**
1. **Эмпирика по refspec (гейт для фазы 3).** На реальном ADO-репозитории владельца проверить, какой refspec реально приносит base/head коммиты PR: `refs/pull/{id}/merge`, `refs/pull/{id}/head`, либо прямой fetch по `commitId` из `lastMergeSourceCommit`. Зафиксировать рабочий вариант письменно.
2. **Smoke-проверка SDK.** Установить `azure-devops-node-api` (в `server/package.json` его сейчас **нет**), сделать минимальный вызов «список PR» с реальным PAT. Зафиксировать: форму ответа `iterations/{id}/changes`, наличие `changeTrackingId`, наличие/отсутствие `pullRequestThreadContext.iterationContext` (нужно для R-D).
3. **Характеризационные тесты (закрывает P3).** Написать интеграционные тесты, фиксирующие **текущее** поведение GitHub-пути ДО любого рефакторинга: `POST /repos` с github-URL, `GET /pulls/:id` с непустым `patch`, `GET/POST /pulls/:id/comments`. Это и есть базовая линия для AC-54.

**Acceptance Criteria:**
- [ ] AC-000-1: рабочий refspec для ADO PR определён эмпирически и записан (→ R26)
- [ ] AC-000-2: форма ответа `iterations/{id}/changes` зафиксирована на реальных данных, включая наличие `changeTrackingId` (→ R21, R38)
- [ ] AC-000-3: характеризационные тесты GitHub-пути написаны и **зелёные на текущем коде** (→ R54)
- [ ] AC-000-4: `azure-devops-node-api` добавлен в `server/package.json`

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-000-1 | `git fetch <ado-url> <refspec>` на реальном репо → коммит присутствует локально; `git cat-file -t <sha>` = `commit` |
| AC-000-2 | Записанный JSON-фикстур реального ответа лежит в `adapters/azure-devops/__fixtures__/` |
| AC-000-3 | `cd server && pnpm exec vitest run characterization` → все зелёные **до** изменений кода |
| AC-000-4 | `grep azure-devops-node-api server/package.json` → совпадение |

> ⛔ **Гейт:** фаза 3 (TASK-006, TASK-007) не стартует, пока AC-000-1 и AC-000-2 не закрыты.

---

### TASK-001: Контракты и схема БД

**Scope:** backend + frontend (зеркальная копия контрактов)

**Owned Paths:**
- `server/src/vendor/shared/adapters.ts`
- `server/src/vendor/shared/contracts/platform.ts`
- `client/src/vendor/shared/adapters.ts`
- `client/src/vendor/shared/contracts/platform.ts`
- `server/src/db/schema/repos.ts`
- `server/src/db/migrations/0025_*.sql` (генерируется, не пишется руками)

**Что делаем:**
1. `RepoRef` (сейчас `{owner, name}`, `adapters.ts:98-101`) → `{owner, name, project?, baseUrl?}`. Существующие вызовы `{owner, name}` обязаны компилироваться без правок.
2. Ввести `VcsProvider = 'github' | 'azure-devops'`.
3. Переименовать `GitHubClient` (`adapters.ts:179-217`, 13 методов) → `VcsClient`, добавить первой строкой `readonly id: VcsProvider` — точно по образцу `LLMProvider` (`adapters.ts:82-88`). Оставить `export type GitHubClient = VcsClient` как deprecated-алиас, чтобы не ломать существующие импорты за один шаг.
4. Заменить `postReview` в порту на `publishComment(repo, n, input): Promise<PrReviewComment>` (решение Q1). `GitHubReviewPayload` остаётся, но переезжает в приватную область Octokit-реализации.
5. `SecretKey` (`adapters.ts:324-329`) — добавить литерал `'AZURE_DEVOPS_TOKEN'`. Union открытый (`(string & {})`), но литерал нужен для автодополнения и явности.
6. `platform.ts`: `ConnTestProvider` (`:122-128`) += `"azure-devops"`; `SecretsStatus` (`:147-153`, плоский объект, **не** выводится из enum) += поле `azureDevops: bool`; `Repo` (`:161-172`) += `vcs_provider`, `project` (nullish), `base_url` (nullish); `PrDetail` (`:233-239`) += `diff_unavailable` (опциональное, enum-reason); `PrReviewComment` (`:247-261`) += `thread_id` (nullish).
7. Схема `repos` (`db/schema/repos.ts`): три новые колонки; уникальный индекс `repos_ws_fullname_uq` (строка 22) заменяется на `(workspaceId, vcsProvider, fullName)`.
8. `pnpm db:generate` → миграция `0025_*` (следующая после `0024_fresh_stone_men.sql`), затем `pnpm db:migrate`.

**Конвенции, которые обязательны:**
- Опциональные DTO-поля — через `.nullish()`, а не `.nullable()`/`.optional()` (`server/insights/INSIGHTS.md:72`).
- Все 4 файла контрактов правятся **синхронно** (см. P1). Клиентская копия импортирует соседние контракты **без** расширения `.js` — иначе сборка клиента падает (`client/insights/INSIGHTS.md:34`).
- `vcs_provider` — `TEXT NOT NULL DEFAULT 'github'` + `CHECK (vcs_provider IN ('github','azure-devops'))`. Не PG-enum: значение business-logic-driven, добавление третьего провайдера не должно требовать `ALTER TYPE`.
- DEFAULT неволатильный ⇒ бэкфилл существующих строк не переписывает таблицу.

**Acceptance Criteria:**
- [ ] AC-001-1: `VcsClient` содержит `readonly id: VcsProvider`; простое переименование без дискриминатора отвергается (→ R8)
- [ ] AC-001-2: существующие вызовы `{ owner, name }` компилируются без изменений (→ R10)
- [ ] AC-001-3: миграция проставляет всем существующим строкам `vcs_provider='github'`, `project=null`, `base_url=null` (→ R5, R56)
- [ ] AC-001-4: уникальность репо — тройка `(workspace_id, vcs_provider, full_name)` (→ R6)
- [ ] AC-001-5: `SecretKey`, `ConnTestProvider`, `SecretsStatus` расширены (→ R14, R15)
- [ ] AC-001-6: `PrDetail.diff_unavailable` и `PrReviewComment.thread_id` — опциональные, обязательных provider-специфичных полей не добавлено (→ R29, R36)
- [ ] AC-001-7: серверная и клиентская копии контрактов идентичны по форме (→ P1)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-001-1 | `grep -n "readonly id" server/src/vendor/shared/adapters.ts` → совпадение внутри `VcsClient` |
| AC-001-2 | `cd server && pnpm typecheck` → 0 ошибок |
| AC-001-3 | Integration: прогнать миграцию на снимке с GitHub-репо, `SELECT vcs_provider FROM repos` → все `'github'` |
| AC-001-4 | Integration: вставить `github:acme/api` и `ado:acme/api` → 2 строки, без нарушения индекса |
| AC-001-5 | `PrDetail.parse()` на GitHub-фикстуре без `diff_unavailable` → проходит |
| AC-001-7 | `diff <(...)` серверной и клиентской `platform.ts` по списку полей → расхождений нет |
| все | `cd client && pnpm typecheck` → 0 ошибок |

---

### TASK-002: Порт, DI и тестовые двойники

**Scope:** backend

**Owned Paths:**
- `server/src/adapters/github/octokit.ts`
- `server/src/adapters/mocks.ts`
- `server/src/platform/container.ts`

**Что делаем:**
1. `OctokitGitHubClient` (`octokit.ts:32`) → `implements VcsClient`, добавить `readonly id = 'github' as const`. Внутреннюю логику не трогаем: `withRetry(() => withTimeout(p, 30_000))` остаётся как есть (R46 — GitHub-путь не меняется).
2. Реализовать `publishComment` в Octokit-клиенте поверх существующего `createReviewComment`; `postReview` становится приватным.
3. `MockGitHubClient` (`mocks.ts:153`) → `MockVcsClient` с конструируемым `id`. Сохранить `export const MockGitHubClient = MockVcsClient` как алиас, чтобы существующие тесты не правились (R55).
4. `Container`: заменить `async github()` (`container.ts:203-210`) на `async vcs(repo: { vcsProvider: VcsProvider, ... }): Promise<VcsClient>`. **Образец для копирования — не текущий `github()`, а `llm(id)` с `llmCache: Map` (`container.ts:78, 213-245`)**: это единственный существующий в кодовой базе паттерн мультипровайдерного DI, и он уже решает задачу кэширования по ключу.
5. `ContainerOverrides` (`container.ts:50-64`): `github?: GitHubClient` → `vcs?: Partial<Record<VcsProvider, VcsClient>>` — по образцу существующего `llm?: Partial<Record<...>>` в том же интерфейсе.
6. `invalidateSecretCaches()` (`container.ts:268-272`) — чистит кэш обоих провайдеров.
7. Обновить все вызовы `container.github()` на `container.vcs(repo)`. Известные точки: `pulls/routes.ts` (несколько), `ci/service.ts:241`, `ci/service.ts:288`.

**Acceptance Criteria:**
- [ ] AC-002-1: `Container.vcs(repo)` диспетчеризует по `repo.vcsProvider`; вызовов `container.github()` в кодовой базе не осталось (→ R9)
- [ ] AC-002-2: `new AzureDevOpsClient` встречается ровно один раз — в `container.ts` (→ R9); на этой фазе класс ещё заглушка
- [ ] AC-002-3: `MockVcsClient` покрывает оба провайдера; ни один существующий тест не правился (→ R55)
- [ ] AC-002-4: полный существующий suite зелёный (→ R54)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-002-1 | `grep -rn "container.github()" server/src` → 0 совпадений |
| AC-002-2 | `grep -rn "new AzureDevOpsClient" server/src` → ровно 1 совпадение, файл `platform/container.ts` |
| AC-002-3 | `git diff --stat` по существующим `*.test.ts` → 0 изменённых строк в ассертах |
| AC-002-4 | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` + `pnpm exec vitest run .it.test` → зелёные; характеризационные тесты из TASK-000 тоже зелёные |

---

### TASK-003: Секреты, test-connection, Settings (backend)

**Scope:** backend

**Owned Paths:**
- `server/src/adapters/secrets/local.ts`
- `server/src/modules/settings/constants.ts`
- `server/src/modules/settings/routes.ts`
- `server/src/adapters/azure-devops/auth.ts` (новый)

**Что делаем:**
1. `LocalSecretsProvider.get()` (`local.ts:37-42`): добавить `AZURE_DEVOPS_TOKEN`. Fallback на env — по той же схеме, что уже есть у `GITHUB_TOKEN`/`GITHUB_PAT`. Это **единственное** место в кодовой базе, где читается `process.env`.
2. `SECRET_KEY_BY_PROVIDER` (`settings/constants.ts:8`, плоский `Record`) += `'azure-devops' → 'AZURE_DEVOPS_TOKEN'`.
3. Test-connection для `azure-devops`: Basic auth с **пустым username и PAT в качестве пароля**, обращение к профильному эндпоинту. Заголовок собирается в `adapters/azure-devops/auth.ts` (одно место на весь адаптер — переиспользуется в TASK-006/008).
4. Маскирование PAT в ответах — переиспользовать существующий механизм для уже имеющихся ключей.

**Acceptance Criteria:**
- [ ] AC-003-1: `GET /settings/secrets-status` содержит ключ `azure-devops` (→ R15)
- [ ] AC-003-2: валидный PAT → `ok:true` + непустой `message` с отображаемым именем; невалидный → `ok:false` с человекочитаемой причиной (→ R16)
- [ ] AC-003-3: ни один ответ API не содержит полного значения PAT (→ R18)
- [ ] AC-003-4: новых чтений `process.env` вне `LocalSecretsProvider` не появилось (→ R14)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-003-1 | Integration: `GET /settings/secrets-status` → тело содержит `azure-devops` |
| AC-003-2 | Integration с реальным PAT (есть у владельца) → `ok:true`; с мусорным → `ok:false` |
| AC-003-3 | Integration: `GET /settings` → `grep` полного PAT по телу ответа = 0 совпадений |
| AC-003-4 | `grep -rn "process\.env" server/src --include=*.ts` → совпадения только в `adapters/secrets/local.ts` и `platform/config.ts` |

---

### TASK-004: Определение провайдера и добавление репозитория

**Scope:** backend

**Owned Paths:**
- `server/src/modules/repos/constants.ts`
- `server/src/modules/repos/helpers.ts`
- `server/src/modules/repos/routes.ts`
- `server/src/modules/repos/service.ts`
- `server/src/modules/repos/repository.ts`
- `server/src/modules/repos/parse-repo-url.test.ts` (новый)

**Что делаем:**
1. `constants.ts` (25 строк, сегодня 4 GitHub-литерала): добавить `AZURE_DEVOPS_URL_REGEX` для `dev.azure.com` и `*.visualstudio.com`, константы хостов ADO.
2. `parseRepoUrl` (`helpers.ts:16`, сегодня матчит только `GITHUB_URL_REGEX`) → возвращает дискриминированный результат `{ provider, owner, name, project?, baseUrl? }` либо ошибку `provider_required` для неизвестного хоста (вместо текущего `invalid_repo_url`).
3. `POST /repos` body-схема (`routes.ts:26-31`, сегодня `{ url: z.string().url() }`) → `{ url, vcs_provider?, base_url? }`. Валидация уровня презентации: Zod-схема; правило «при `vcs_provider='azure-devops'` `base_url` обязателен» — через `.superRefine()` с `path: ['base_url']`, чтобы форма подсветила нужное поле.
4. `full_name` для ADO = `org/project/repo`; `owner`=org, `project`=project, `name`=repo.
5. Пробросить новые поля через `service.ts` и `repository.ts` в БД.

**Acceptance Criteria:**
- [ ] AC-004-1: github-URL (https и ssh) → `vcs_provider='github'`, поведение не изменилось (→ R1)
- [ ] AC-004-2: `dev.azure.com` и `*.visualstudio.com` URL → корректные `org/project/repo` + `base_url` (→ R2)
- [ ] AC-004-3: неизвестный хост → код `provider_required`, **не** `invalid_repo_url` (→ R3)
- [ ] AC-004-4: `vcs_provider='azure-devops'` с пустым `base_url` → ошибка валидации на поле `base_url` (→ R4)
- [ ] AC-004-5: ADO-URL без `_git` или без трёх уровней → ошибка с примером корректного формата (→ R7)
- [ ] AC-004-6: `github:acme/api` и `ado:acme/api` сосуществуют (→ R6)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-004-1…5 | Unit: табличный тест «URL → `{provider, org, project, repo, baseUrl}` \| ошибка», покрывающий ssh-форму GitHub, `dev.azure.com`, `*.visualstudio.com`, self-hosted, битые URL. `pnpm exec vitest run parse-repo-url` |
| AC-004-3 | Integration: `POST /repos` c `https://ado.company.local/...` → тело содержит `provider_required` |
| AC-004-6 | Integration: два `POST /repos` → 2 строки в `repos`, оба 2xx |
| регрессия | Характеризационный тест `POST /repos` из TASK-000 остаётся зелёным (→ R54) |

---

### TASK-005: Клонирование и git-аутентификация ADO

**Scope:** backend
**Обоснование позиции в очереди:** см. раздел «Отклонения от предложенного порядка фаз» — фаза 3 (diff) без этого не работает.

**Owned Paths:**
- `server/src/modules/repos/helpers.ts` (продолжение TASK-004)
- `server/src/modules/repos/service.ts` (продолжение TASK-004)
- `server/src/adapters/git/simple-git.ts`
- `server/src/vendor/shared/adapters.ts` (только сигнатура `GitClient`)

**Что делаем:**
1. Обобщить `withGitHubToken` (`helpers.ts:29` — сегодня переписывает URL только если `hostname === 'github.com'`, подставляя `x-access-token:token`). Ввести диспетчер `withVcsToken(url, provider, token)`: GitHub — `x-access-token:{token}`, ADO — **пустой username + PAT как пароль**. Это разные конвенции, переиспользовать одну функцию нельзя.
2. Убрать литерал `https://github.com/${repo.fullName}.git` (`service.ts:121`, внутри `refresh()`) — clone URL собирается из `vcs_provider` + `base_url` + идентификатора.
3. **Решить P2 (коллизия клонов).** `SimpleGitClient.clonePathFor` (`simple-git.ts:38`) = `join(cloneDir, owner, name)` → добавить сегмент провайдера: `join(cloneDir, provider, owner, [project], name)`. ⚠️ Меняет пути **существующих** GitHub-клонов ⇒ нужен либо разовый ремап `repos.clone_path`, либо сохранение старой схемы пути для `provider='github'`. **Рекомендуемый вариант — второй:** ветвление по провайдеру, GitHub-путь остаётся байт-в-байт прежним. Это дешевле и полностью снимает риск регрессии (R54).
4. `GitClient.fetchPullHead(repo, n)` (`adapters.ts:255-278`) — сегодня зашит на GitHub-refspec. Расширить, чтобы принимал refspec/провайдера. Конкретный ADO-refspec берётся из результата TASK-000.
5. PAT не должен оседать в `.git/config`: аутентифицированный URL используется **только** для операции clone/fetch, постоянный remote переписывается на чистый URL.

**Acceptance Criteria:**
- [ ] AC-005-1: после клона ADO-репо `.git/config` не содержит подстроки PAT; `grep` PAT по всему каталогу клона = 0 совпадений (→ R41)
- [ ] AC-005-2: в `repos/service.ts` нет литерала `github.com` (→ R42)
- [ ] AC-005-3: PAT отсутствует в логах сервера, включая логи ошибок и retry (→ R43)
- [ ] AC-005-4: clone_path для `github:acme/api` и `ado:acme/proj/api` не совпадают (→ P2)
- [ ] AC-005-5: clone_path существующих GitHub-репозиториев не изменился (→ R54)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-005-1 | Integration: клон реального ADO-репо → `grep -r "$PAT" <clone_dir>` = 0; `grep "$PAT" <clone_dir>/.git/config` = 0 |
| AC-005-2 | `grep -n "github\.com" server/src/modules/repos/service.ts` → 0 совпадений |
| AC-005-3 | Integration: сценарий с ошибкой авторизации → `grep "$PAT"` по собранным логам = 0 |
| AC-005-4 | Unit: `clonePathFor` для двух репо → разные строки |
| AC-005-5 | Unit: `clonePathFor({provider:'github', owner:'acme', name:'api'})` === прежнее значение |

---

### TASK-006: AzureDevOpsClient — чтение PR

**Scope:** backend
> ⛔ Требует закрытого гейта TASK-000 (AC-000-1, AC-000-2).

**Owned Paths:**
- `server/src/adapters/azure-devops/` (весь каталог: `client.ts`, `mappers.ts`, `constants.ts`, `auth.ts`, `__fixtures__/`)
- `server/src/adapters/azure-devops/client.test.ts` (новый)

**Что делаем:**
1. `AzureDevOpsClient implements VcsClient` с `readonly id = 'azure-devops' as const`, на официальном `azure-devops-node-api`.
2. `listPullRequests` → `PrMeta[]`. Маппинг живёт в отдельном `mappers.ts` (чистые функции, тестируются без сети): `pullRequestId→number`; `active|completed|abandoned → open|merged|closed`; `targetRefName`/`sourceRefName` со стрипом `refs/heads/`; `lastMergeSourceCommit.commitId→head_sha`; `createdBy→author`. `additions`/`deletions`/`files_count` = 0.
3. `getPullRequest` → метаданные + файлы через `iterations/{latestIterationId}/changes`, `$top ≤ 2000`, цикл пагинации до `nextTop`/`nextSkip == 0`. `changeTrackingId` сохраняется — понадобится в TASK-008 (R38).
4. Guard-clause: если `vcs_provider='azure-devops'`, а `project` в `RepoRef` отсутствует — configuration-error **до** любого сетевого вызова. Это доменный инвариант ⇒ обычный `if (!project) throw new ConfigError(...)`, без Zod.
5. Неподдерживаемые методы (`openPullRequest`, `commitFiles`, `findOpenPr`, `listWorkflowRuns`, `downloadArtifact`, `getIssue`) → единый хелпер `notSupported('azure-devops', 'methodName')`. Никаких «пустых успехов».
6. `linked_issue` для ADO не заполняется — шаг пропускается без ошибки (Work Items вне скоупа).
7. `patch` на этой фазе — `null`; заполнение переносится в TASK-007.

**Acceptance Criteria:**
- [ ] AC-006-1: маппинг полей ADO PR → `PrMeta` корректен на фикстуре реального ответа (→ R19)
- [ ] AC-006-2: `additions/deletions/files_count` = 0 в списке; в detail добираются существующим backfill (→ R20)
- [ ] AC-006-3: PR с 2500+ изменёнными файлами возвращает **все** файлы, усечения нет (→ R21)
- [ ] AC-006-4: `listPullRequests({owner,name})` без `project` → configuration-error, сетевой вызов не выполнен (→ R11)
- [ ] AC-006-5: `listWorkflowRuns()` → `not_supported` с текстом, содержащим `'azure-devops'` и `'listWorkflowRuns'` (→ R12)
- [ ] AC-006-6: прогон агента на ADO PR с `Closes #12` в теле завершается успешно, `linked_issue` отсутствует (→ R23)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-006-1 | Unit: табличный тест маппинга на фикстуре из TASK-000. `pnpm exec vitest run adapters/azure-devops` |
| AC-006-2 | Integration: после списка `additions=0`; после `GET /pulls/:id` — ненулевые в БД |
| AC-006-3 | Unit: фикстура с `nextSkip>0` → выполнены повторные страницы; счётчик файлов = 2500 |
| AC-006-4 | Unit: spy на fetch/SDK → не вызывался; брошена ошибка конфигурации |
| AC-006-5 | Unit: `expect(...).toThrow(/azure-devops.*listWorkflowRuns/)` |
| AC-006-6 | Integration: прогон завершается `completed`, `linked_issue` = null |

---

### TASK-007: Общий diff-first загрузчик и критичный diff-path

**Scope:** backend
> ⛔ Требует закрытого гейта TASK-000. **Это критический путь всей фичи.**

**Owned Paths:**
- `server/src/modules/_shared/diff/` (новый: `diff-loader.ts`, `split-by-file.ts`, `*.test.ts`)
- `server/src/modules/reviews/diff-loader.ts` (переезд + реэкспорт)
- `server/src/modules/pulls/routes.ts` (только detail-путь, строки ~253–366)
- `server/src/adapters/azure-devops/client.ts` (продолжение TASK-006 — заполнение `patch`)

**Что делаем:**
1. **Вынести diff-first загрузчик** (решение R-B). Сегодня `reviews/diff-loader.ts` (45 строк) содержит `loadDiff` (сначала `container.git.diff()`, при ошибке или нуле файлов — fallback на `diffFromPrFiles`) и `diffFromPrFiles`. Переезжает в `modules/_shared/diff/`; `reviews/diff-loader.ts` остаётся тонким реэкспортом, чтобы не трогать вызывающий код `reviews`.
2. **Переписать detail-путь `pulls`.** Сегодня `pulls/routes.ts:277-295` вызывает `gh.getPullRequest()` и пишет `f.patch ?? null` в `pr_files` **напрямую из ответа провайдера**, минуя diff-loader (`server/insights/INSIGHTS.md:159`). Именно поэтому для ADO там оказался бы `null` во всех файлах. Перевести на общий diff-first загрузчик. ⚠️ Сохранить существующий fallback-путь на персистированные `pr_files`/`pr_commits` при ошибке провайдера (`routes.ts:328-363`) — это рабочий offline-режим, ломать нельзя.
3. **Сплиттер unified diff по файлам** (R28). Переиспользовать существующий `parseUnifiedDiff` (`server/src/adapters/git/diff-parser.ts:14-79`) — писать парсер заново не нужно. Поверх него — `splitUnifiedDiffByFile(raw): Map<path, patch>`, где каждый patch начинается с `@@` и **не** содержит строки `diff --git` (формат GitHub, чтобы клиентские компоненты рендера не менялись).
   ⚠️ Готча из `agent-runner/insights/INSIGHTS.md:26`: `raw.split('\n')` на diff, оканчивающемся `\n`, даёт хвостовой `''`, который парсер обязан отбросить — иначе покрытие последнего ханка завышается на строку.
4. **Fetch перед diff** (R26): гарантировать наличие base/head в клоне по refspec из TASK-000; при неудаче — деградация.
5. **Деградация** (R27): `patch=null` + `diff_unavailable: { reason }` в `PrDetail`. Причины: `clone_missing`, `clone_in_progress`, `commits_missing`, `diff_failed`.
6. `PrFile.additions/deletions` для ADO — из локально вычисленного diff; при недоступности diff — 0, не выдуманные значения.

**Acceptance Criteria:**
- [ ] AC-007-1: `GET /pulls/:id` для ADO-репо → каждый файл имеет непустой `patch` (→ R24)
- [ ] AC-007-2: detail-путь `pulls` использует общий diff-first загрузчик; для GitHub-репо `patch` по-прежнему непустой (→ R25, регрессия)
- [ ] AC-007-3: PR, head которого отсутствует локально, после detail-запроса даёт непустой `patch` (→ R26)
- [ ] AC-007-4: ADO-репо без `clone_path` → `patch=null` + `diff_unavailable.reason` в ответе (→ R27)
- [ ] AC-007-5: каждый нарезанный `patch` начинается с `@@`, строки `diff --git` не содержит (→ R28)
- [ ] AC-007-6: `PrDetail.parse()` ответа ADO проходит тем же контрактом, что и GitHub (→ R29)
- [ ] AC-007-7: `additions/deletions` совпадают с `git diff --numstat`; при отсутствии клона = 0 (→ R22)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-007-1 | Integration на реальном ADO PR: каждый элемент `files[]` имеет `patch !== null` |
| AC-007-2 | Характеризационный тест `GET /pulls/:id` из TASK-000 остаётся зелёным |
| AC-007-3 | Integration: удалить head-коммит из клона → после detail `patch` непустой |
| AC-007-4 | Integration: `clone_path = null` → тело ответа содержит `diff_unavailable` |
| AC-007-5 | Unit: вход = `git diff` одного PR, выход = `Map<path, patch>`, `expect(patch.startsWith('@@')).toBe(true)` для каждого |
| AC-007-6 | Integration: `PrDetail.parse(adoResponse)` не бросает |
| AC-007-7 | Integration: сравнить с эталонным `git diff --numstat` для того же диапазона коммитов |

---

### TASK-008: Публикация комментариев в ADO PR

**Scope:** backend

**Owned Paths:**
- `server/src/adapters/azure-devops/threads.ts` (новый)
- `server/src/adapters/azure-devops/finding-id.ts` (новый)
- `server/src/modules/pulls/routes.ts` (только comments-роуты, строки ~391–465)

**Что делаем:**
1. `publishComment` (сигнатура из Q1) в ADO-реализации: сначала `GET threads`, матчинг по `properties['devdigest.findingId']`; найден → PATCH комментария, не найден → `POST threads`. Атомарный batch-путь для ADO не используется — в ADO нет батч-эндпоинта.
2. `threadContext`: `filePath` + `rightFileStart`/`leftFileStart` в зависимости от стороны диффа.
3. **Позиционирование между итерациями (R38, решение R-D):** использовать `pullRequestThreadContext.{changeTrackingId, iterationContext}`, а **не** `threadContext` — `changeTrackingId` в ADO живёт именно там. `changeTrackingId` приходит из `iterations/{id}/changes` (сохранён в TASK-006). Если id итераций недоступны — graceful degradation до чистого `threadContext`: комментарий всё равно публикуется, просто без авто-пересчёта позиции.
4. Стабильный `findingId` — детерминированный хэш от (repo, PR number, path, line, severity, title). Чистая функция в отдельном файле, тестируется на детерминизм.
5. **Untrusted input:** `properties['devdigest.findingId']` приходит с внешней стороны. Валидировать по ожидаемому формату (например, hex фиксированной длины) **перед** матчингом. Не использовать значение напрямую.
6. Свободный комментарий (не по находке) → новый тред **без** property идемпотентности.
7. `listReviewComments` → `GET threads` + разворачивание в плоский `PrReviewComment[]`, фильтр `commentType != 'text'` и удалённых.
8. `in_reply_to` для ADO трактуется как id треда — комментарий добавляется в существующий тред.
9. `html_url` = `{baseUrl}/{org}/{project}/_git/{repo}/pullrequest/{id}?discussionId={threadId}`.
10. Ошибка одного комментария — локальна, без отката уже опубликованных.
11. ⚠️ Comments-роуты сегодня **живой проксирующий путь без локальной персистенции** (`pulls/routes.ts:369-371`). Сохранить эту модель для ADO — не заводить зеркало в БД.

**Acceptance Criteria:**
- [ ] AC-008-1: прогон агентов на ADO PR не создаёт ни одного thread (→ R30)
- [ ] AC-008-2: созданный thread содержит `properties['devdigest.findingId']`; маппинг side→right/leftFileStart корректен (→ R31)
- [ ] AC-008-3: одинаковый вход → одинаковый хэш между процессами; изменение любого атрибута → другой хэш (→ R32)
- [ ] AC-008-4: публикация одной находки дважды → ровно 1 thread, содержимое обновлено (→ R33)
- [ ] AC-008-5: два свободных комментария на одной строке → 2 треда (→ R34)
- [ ] AC-008-6: системный thread об обновлении PR отсутствует в ответе (→ R35)
- [ ] AC-008-7: ответ на ADO-комментарий добавляется в существующий тред (→ R36)
- [ ] AC-008-8: `html_url` открывает конкретное обсуждение (→ R37)
- [ ] AC-008-9: после push новой итерации комментарий остаётся на своей строке (→ R38)
- [ ] AC-008-10: 500 на `POST threads` → ранее созданные треды не удаляются, повтор не создаёт дубликат (→ R39)
- [ ] AC-008-11: `AzureDevOpsClient` не реализует атомарный batch-review; N находок = N POST threads (→ R40)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-008-1 | Integration: прогон агента → `GET threads` возвращает 0 devdigest-тредов |
| AC-008-3 | Unit: два вызова в разных процессах → строгое равенство; мутация каждого атрибута → неравенство |
| AC-008-4 | Integration на реальном ADO PR: опубликовать дважды → `threads.filter(devdigest).length === 1` |
| AC-008-6 | Integration: PR с системным тредом → его нет в `PrReviewComment[]` |
| AC-008-9 | **Ручная проверка на реальном ADO** (доступ есть): опубликовать → push новой итерации → комментарий на своей строке |
| AC-008-10 | Integration: мок 500 → предыдущие треды на месте; повтор → без дубликата |
| AC-008-11 | Code review: batch-метод в ADO-реализации отсутствует; integration — счётчик POST-запросов === N |

---

### TASK-009: Rate limits, ошибки авторизации, CI-guard

**Scope:** backend

**Owned Paths:**
- `server/src/adapters/azure-devops/retry.ts` (новый)
- `server/src/adapters/azure-devops/errors.ts` (новый)
- `server/src/adapters/azure-devops/constants.ts` (продолжение TASK-006)
- `server/src/modules/ci/service.ts`
- `server/src/modules/ci/routes.ts`

**Что делаем:**
1. **ADO-retry как надстройка над `withRetry`** (R46 — строго не форк). Важно: `defaultIsRetryable` в `resilience.ts:35-63` проверяет `status`/`statusCode`/`response.status`, а ошибки ADO REST имеют другую форму (`TypeInfo`/`typeKey`) ⇒ **429 от ADO может молча считаться неретраябельным**. Новый `adoIsRetryable` передаётся в `withRetry` через существующую опцию `isRetryable`, плюс задержка берётся из `Retry-After`.
2. Пороги — константы модуля адаптера (решение R-C): ≤3 повторов, ≤60с суммарно, затем `vcs_rate_limited`.
3. Логировать `X-RateLimit-Remaining` / `X-RateLimit-Delay` — **без PAT**.
4. **Защитный парсинг auth-ошибок** (R47): 401/403 → `vcs_unauthorized` + подсказка о scope (`vso.code`, `vso.code_write`, `vso.threads_full`). Никакой привязки к тексту сообщения ADO.
5. **Не-JSON ответ** (R48): HTML-страница входа, часто с кодом 203 → `vcs_unauthorized`, а не пустой успешный результат. Проверять `content-type` перед разбором.
6. **CI-guard** (R13): в `ci/service.ts` перед вызовами `listWorkflowRuns` (`:241`) и `downloadArtifact` (`:288`) — проверка `repo.vcsProvider`; для ADO управляемая 4xx `ci_not_supported_for_provider`, не 500 и не тихий пустой результат.

**Acceptance Criteria:**
- [ ] AC-009-1: мок 429 + `Retry-After: 2` → ровно 3 повтора, суммарная задержка ≤60с, затем `vcs_rate_limited` (→ R44)
- [ ] AC-009-2: ответ с rate-limit заголовками → значения в логе, PAT в логе отсутствует (→ R45)
- [ ] AC-009-3: ADO-retry импортирует существующий `withRetry`; GitHub-путь не изменён (→ R46)
- [ ] AC-009-4: мок 403 с произвольным телом → `vcs_unauthorized` + подсказка со списком scope (→ R47)
- [ ] AC-009-5: `text/html` + 203 → `vcs_unauthorized`, не пустой список PR (→ R48)
- [ ] AC-009-6: CI-эндпоинт для ADO-репо → 4xx `ci_not_supported_for_provider` (→ R13)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-009-1 | Unit с фейковым таймером (`vi.useFakeTimers()`): счётчик попыток === 3, сумма задержек ≤ 60000 |
| AC-009-2 | Integration: `grep` значений remaining/delay в логе — есть; `grep "$PAT"` — 0 |
| AC-009-3 | `grep -n "withRetry" server/src/adapters/azure-devops/retry.ts` → импорт из `platform/resilience`; `git diff platform/resilience.ts` → только экспорты, логика не тронута |
| AC-009-4 | Integration: мок 403 → тело содержит `vcs_unauthorized` и все три scope |
| AC-009-5 | Unit: мок `content-type: text/html` + 203 → бросает `vcs_unauthorized` |
| AC-009-6 | Integration: `POST/GET` ci-эндпоинт для ADO-репо → 4xx + код |

---

### TASK-010: UI

**Scope:** frontend

**Owned Paths:**
- `client/src/lib/utils/githubUrls.ts` → `client/src/lib/utils/vcsUrls.ts`
- `client/src/lib/utils/index.ts`
- `client/src/lib/hooks/repos.ts`
- `client/src/app/page.tsx`
- `client/src/app/onboarding/_components/AddRepoView/`
- `client/src/app/settings/[section]/_components/SettingsView/_components/SettingsApiKeys/`
- `client/messages/` (i18n)
- 7 файлов-потребителей `githubUrls` (см. ниже)

**Что делаем:**
1. **Deep-links (R52).** `client/src/lib/utils/githubUrls.ts` экспортирует `githubPrUrl` и `githubBlobUrl` с захардкоженным `const HOST = "https://github.com"`. Заменить на provider-aware билдеры. Форма ADO принципиально другая: PR — `{baseUrl}/{org}/{project}/_git/{repo}/pullrequest/{id}`; файл — query-параметры `?path=...&version=GC{sha}`, а **не** path-сегменты + `#L{n}`.
   **Потребители (7 файлов, все обязаны быть обновлены):** `app/repos/[repoId]/pulls/[number]/page.tsx`, `_components/FindingCard/FindingCard.tsx`, `app/repos/[repoId]/onboarding/_components/CriticalPathsSection.tsx` (+ `.test.tsx`), `ReadingPathSection.tsx` (+ `.test.tsx`), реэкспорт в `lib/utils/index.ts`.
2. **Provider badge (R49).** Отдельного «repos list page» нет — список живёт на дашборде `client/src/app/page.tsx` через `useRepos()`. Добавить метку провайдера туда.
3. **Форма добавления репо (R51).** `AddRepoView.tsx` — сегодня один `TextInput` для URL, плейсхолдер зашит как `https://github.com/owner/repo`. Добавить: индикатор автоопределённого провайдера до сабмита; при неизвестном хосте — dropdown провайдера + поле `baseUrl`. `useAddRepo()` в `lib/hooks/repos.ts` расширить с `{ url }` до `{ url, vcs_provider?, base_url? }`.
4. **Settings (R50, R17).** `SettingsApiKeys` управляется массивом `KEY_ROWS` в соседнем `constants.ts` (сейчас 4 строки: openai/anthropic/openrouter/github). Добавить пятую — `azure-devops`. Валидатор формата PAT (84 симв., `AZDO` в поз. 76–80) — **неблокирующее** предупреждение: кнопка сохранения остаётся активной, self-hosted ADO Server может выпускать токены другого формата.
5. **Недоступность диффа (R27, клиентская часть).** Обработать `PrDetail.diff_unavailable` — показать сообщение с причиной вместо пустой вкладки.

**Обязательные конвенции клиента:**
- Все строки — через `useTranslations()` (`next-intl`). Хардкода английского в JSX быть не должно.
- Поля ключей — write-only: `GET /settings` возвращает только маску, префилл из ответа запрещён (`client/insights/gotchas.md:15`).
- Компоненты рендера диффа и находок (`SmartDiffViewer`, `FindingCard`, `SeverityFilter`) **не меняются** — контракт `PrDetail` для обоих провайдеров идентичен. Правка `FindingCard` в этой задаче касается **только** построения внешней ссылки.
- Server Component по умолчанию; `"use client"` — только там, где нужна интерактивность, и как можно глубже по дереву.
- a11y — вне скоупа проекта.

**Acceptance Criteria:**
- [ ] AC-010-1: в списке с двумя репо видны две разные метки провайдера (→ R49)
- [ ] AC-010-2: Settings → ввести ADO PAT → Test connection → отображён результат ok/fail (→ R50)
- [ ] AC-010-3: ввод `dev.azure.com` URL → индикатор «Azure DevOps»; неизвестный хост → появляются dropdown и `baseUrl` (→ R51)
- [ ] AC-010-4: для ADO-репо ссылка ведёт на `baseUrl/org/project/_git/repo`, не на `github.com` (→ R52)
- [ ] AC-010-5: PAT неверного формата → предупреждение, кнопка сохранения активна (→ R17)
- [ ] AC-010-6: при `diff_unavailable` вкладка показывает сообщение, а не пустоту (→ R27)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-010-1,2,3,6 | E2E-флоу (`e2e/specs/NN-*.flow.json`, запуск `./scripts/e2e.sh`). ⚠️ Ассерты по тексту — подстрочные; для точной проверки использовать `find` с `data-testid` |
| AC-010-4 | Unit: билдер URL для ADO-репо → ожидаемая строка. `cd client && pnpm test` |
| AC-010-5 | Unit: валидатор формата — 84/`AZDO` → без предупреждения, иначе предупреждение; кнопка не `disabled` |
| регрессия | Существующие тесты `CriticalPathsSection.test.tsx`, `ReadingPathSection.test.tsx` — зелёные |

---

### TASK-011: Сквозная регрессия и верификация на реальном ADO

**Scope:** backend + frontend + e2e

**Owned Paths:**
- `server/src/modules/repos/dual-provider.it.test.ts` (новый)
- `e2e/specs/08-azure-devops.flow.json` (новый)
- `e2e/specs/coverage.md`

**Что делаем:**
1. Смешанный сценарий: два репозитория обоих провайдеров в одном workspace, параллельные операции.
2. **Сквозная проверка на реальном ADO-проекте владельца** (спека: «mock-тестов недостаточно»): добавить репо → опрос PR → прогон агента → находки → дифф с находками → публикация комментария → повторная публикация без дубликата.
3. Прогон полного suite и сверка с базовой линией TASK-000.
4. Обновить `e2e/specs/coverage.md`.

**Acceptance Criteria:**
- [ ] AC-011-1: параллельные операции над GitHub- и ADO-репо дают корректные результаты обоих; глобального переключателя режима нет (→ R53)
- [ ] AC-011-2: unit + integration + e2e зелёные; в существующих GitHub-тестах ассерты не смягчены (→ R54)
- [ ] AC-011-3: миграция на снимке с GitHub-репо → poll/detail/review работают без ручного вмешательства (→ R56)
- [ ] AC-011-4: сквозной сценарий на реальном ADO PR пройден полностью (→ R-E)

**Verification:**
| AC | Как измеряем |
|---|---|
| AC-011-1 | `pnpm exec vitest run dual-provider.it.test` |
| AC-011-2 | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` + `pnpm exec vitest run .it.test` + `cd client && pnpm test` + `./scripts/e2e.sh`; `git diff` по существующим тестам — ассерты не ослаблены |
| AC-011-3 | Integration на снимке БД до миграции |
| AC-011-4 | Ручной прогон на реальном ADO PR, результат зафиксирован |

---

## Implementation Phases

> ⚙️ Режим выполнения: **single-agent, строго последовательно.** Параллельных потоков нет — рефакторинг общего порта (`adapters.ts`, `container.ts`, `mocks.ts`) неизбежно пересекается между задачами, а изоляции рабочего дерева между implementer-агентами нет.

### Фаза 0: Спайк и базовая линия — **гейт**
- [ ] TASK-000 — refspec эмпирически подтверждён (R26)
- [ ] TASK-000 — форма `iterations/{id}/changes` зафиксирована на реальных данных (R21, R38)
- [ ] TASK-000 — характеризационные тесты GitHub-пути зелёные **до** изменений кода (R54, закрывает P3)
- [ ] `azure-devops-node-api` установлен

### Фаза 1: Контракты, схема, DI, секреты, парсинг URL (группы B, C, A)
- [ ] TASK-001 — `vendor/shared/adapters.ts`: `VcsClient` + `readonly id`, `RepoRef`, `SecretKey`
- [ ] TASK-001 — `vendor/shared/contracts/platform.ts`: `Repo`, `PrDetail`, `PrReviewComment`, `ConnTestProvider`, `SecretsStatus`
- [ ] TASK-001 — **зеркальная правка `client/src/vendor/shared/`** (P1 — иначе клиент не соберётся)
- [ ] TASK-001 — `db/schema/repos.ts` + `pnpm db:generate` → `0025_*` → `pnpm db:migrate` (**никогда не автоматически**)
- [ ] TASK-002 — `platform/container.ts`: `vcs(repo)` по образцу `llm(id)`; `ContainerOverrides`
- [ ] TASK-002 — `adapters/github/octokit.ts` реализует `VcsClient`; `adapters/mocks.ts` → `MockVcsClient` + алиас
- [ ] TASK-003 — `adapters/secrets/local.ts`, `modules/settings/constants.ts`, test-connection
- [ ] TASK-004 — `modules/repos/`: `constants.ts`, `helpers.ts` (`parseRepoUrl`), `routes.ts`, `service.ts`, `repository.ts`
- [ ] ✅ Гейт фазы: полный suite зелёный, GitHub-путь не деградировал (R54)

### Фаза 2: Клонирование и git-auth (группа G) — **перенесена вперёд, см. обоснование выше**
- [ ] TASK-005 — `withVcsToken` вместо `withGitHubToken`
- [ ] TASK-005 — убрать литерал `github.com` из `repos/service.ts:121`
- [ ] TASK-005 — provider-aware `clonePathFor` (решает P2), GitHub-путь неизменен
- [ ] TASK-005 — `fetchPullHead` с refspec из фазы 0
- [ ] ✅ Гейт фазы: реальный ADO-репозиторий клонируется, PAT не в `.git/config` и не в логах

### Фаза 3: ADO read-path и критичный diff-path (группы D + E)
- [ ] TASK-006 — `adapters/azure-devops/`: `client.ts`, `mappers.ts`, `auth.ts`, `constants.ts`, фикстуры
- [ ] TASK-006 — пагинация `iterations/{id}/changes`, guard на отсутствующий `project`, `not_supported`
- [ ] TASK-007 — вынести diff-first загрузчик в `modules/_shared/diff/` (R-B)
- [ ] TASK-007 — **переписать `pulls/routes.ts:277-295`** — сегодня обходит diff-loader
- [ ] TASK-007 — `splitUnifiedDiffByFile` поверх существующего `parseUnifiedDiff`
- [ ] TASK-007 — деградация `diff_unavailable`
- [ ] ✅ Гейт фазы: реальный ADO PR показывает строки диффа; GitHub `patch` по-прежнему непустой

### Фаза 4: Публикация комментариев (группа F)
- [ ] TASK-008 — `adapters/azure-devops/threads.ts`, `finding-id.ts`
- [ ] TASK-008 — идемпотентность через `properties['devdigest.findingId']` + валидация untrusted значения
- [ ] TASK-008 — `pullRequestThreadContext` с graceful degradation (R-D)
- [ ] TASK-008 — comments-роуты `pulls/routes.ts:391-465` остаются живым прокси без персистенции
- [ ] ✅ Гейт фазы: двойная публикация на реальном ADO PR → ровно 1 тред

### Фаза 5: Resilience и CI-guard (группы H, I + AC-13)
- [ ] TASK-009 — `adapters/azure-devops/retry.ts` поверх `withRetry` (не форк)
- [ ] TASK-009 — `adoIsRetryable` — форма ошибок ADO отличается от `defaultIsRetryable`
- [ ] TASK-009 — `errors.ts`: защитный парсинг 401/403 и не-JSON ответов
- [ ] TASK-009 — `ci/service.ts` guard → `ci_not_supported_for_provider`

### Фаза 6: UI (группа J)
- [ ] TASK-010 — `lib/utils/githubUrls.ts` → `vcsUrls.ts` + все 7 потребителей
- [ ] TASK-010 — provider badge на `app/page.tsx`
- [ ] TASK-010 — `AddRepoView` + `lib/hooks/repos.ts`
- [ ] TASK-010 — `SettingsApiKeys/constants.ts` `KEY_ROWS` += `azure-devops`
- [ ] TASK-010 — i18n-строки в `client/messages/`
- [ ] TASK-010 — обработка `diff_unavailable` в UI

### Фаза 7: Сквозная регрессия (группа K)
- [ ] TASK-011 — смешанный dual-provider сценарий
- [ ] TASK-011 — E2E-флоу на реальном ADO
- [ ] TASK-011 — сверка с базовой линией фазы 0

> **Группа K — сквозная, а не только эта фаза.** Гейт «полный существующий suite зелёный» стоит в конце **каждой** фазы, начиная с первой.

---

## Risks & Mitigations

| Риск | Митигация |
|---|---|
| 🚩 **Неверный refspec для head ADO PR** — деградирует каждый ADO PR до `patch: null`, ломает всю группу E | Фаза 0 как жёсткий гейт: эмпирическая проверка на реальном репо до написания кода. Подтверждено `server/insights/INSIGHTS.md:179` |
| 🚩 **Рефакторинг `GitHubClient → VcsClient` ломает GitHub-путь**, а в `repos/`, `pulls/`, `adapters/` нет тестов (P3) | Характеризационные тесты в фазе 0 **до** первого изменения кода. Гейт «suite зелёный» в конце каждой фазы |
| 🚩 **Забыть клиентскую копию контрактов** (P1) — клиент не соберётся или молча разойдётся с сервером | Обе копии в одних owned paths TASK-001; AC-001-7 сверяет их явно |
| **Коллизия clone_path между провайдерами** (P2) — два репо затирают клоны друг друга | Provider-aware `clonePathFor` в TASK-005, при этом GitHub-путь сохраняется байт-в-байт, чтобы не ремапить существующие клоны |
| **`defaultIsRetryable` не распознаёт 429 от ADO** (ошибки ADO имеют форму `TypeInfo`/`typeKey`, а не `status`) — throttling молча считается фатальным | `adoIsRetryable` передаётся через существующую опцию `isRetryable`; явный unit-тест с фейковым таймером |
| **PAT утекает в `.git/config` или логи** | Аутентифицированный URL используется только для clone/fetch, remote переписывается; `grep`-проверки в AC-005-1 и AC-005-3 |
| **`postReview` не имеет аналога в ADO** (R1 из ассесмента, главный технический риск) | Решено на этапе VRF: `publishComment` — один комментарий за вызов; ошибка локальна, ретрай идемпотентен по `findingId` |
| **PR со 100+ итерациями / 2500+ файлами** — медленный detail | Пагинация `$top ≤ 2000` обязательна; NFR: detail для ADO ≤ 2× медианы GitHub на сопоставимом PR |
| **Формат 403 при нехватке `vso.threads_full` не задокументирован** (открытый вопрос №2) | Защитный парсинг без привязки к тексту + обобщённая подсказка обо всех трёх scope. Уточнить после проверки с урезанным PAT |
| **Self-signed TLS на self-hosted ADO Server** | Accepted risk по спеке; проявится как обычная ошибка connection test |
| **Хвостовой `''` после `split('\n')` в diff** завышает покрытие последнего ханка на строку | Известная готча `agent-runner/insights/INSIGHTS.md:26`; фикстурный тест на точный массив номеров строк |
| **Забыть `pnpm db:migrate`** — сервер стартует, а запросы падают в рантайме | Явный чек-лист в фазе 1; `server/insights/gotchas.md:15` |
| **Переименование `*.it.test.ts`** сломает разделение CI-джоб | Суффикс load-bearing (`server/insights/gotchas.md:27`) — новые интеграционные тесты строго с этим суффиксом |

---

## Out of Scope

Взято из спеки без изменений — задач по этим пунктам в плане нет:

1. **Azure Pipelines и любая CI-интеграция для ADO** — генерация `azure-pipelines.yml`, Pipelines REST API, артефакты, обобщение `ci_runs.githubUrl`. Единственное требование этой фичи к CI — управляемая ошибка вместо 500 (R13).
2. **Webhooks / подписки на события ADO** — модель остаётся pull-on-read.
3. **ADO Work Items как linked issue** — `Closes #N` остаётся GitHub-only, для ADO шаг пропускается.
4. **Автоматическая публикация результатов ревью в PR** — только по явному действию пользователя.
5. **Несколько организаций ADO / несколько PAT в workspace** — один `AZURE_DEVOPS_TOKEN` на workspace (подтверждено Q3).
6. **Write-операции в ADO** (`openPullRequest`, `commitFiles`, `findOpenPr`) — падают явной `not_supported`.
7. **Self-signed TLS для self-hosted ADO Server** — accepted risk.
8. **Требования доступности (a11y)** — вне скоупа проекта.
9. Переписывание `reviewer-core/`, `repo-intel/`, `run-executor.ts` — уже provider-agnostic.
10. Изменение `SmartDiffViewer`, `FindingCard`, `SeverityFilter` — контракт `PrDetail` идентичен для обоих провайдеров. Правка `FindingCard` в TASK-010 касается **только** построения внешней ссылки.

---

## Architecture Notes

**Порт с дискриминатором, а не переименование.** `VcsClient` получает `readonly id: 'github' | 'azure-devops'` по образцу единственного существующего в кодовой базе мультипровайдерного порта — `LLMProvider` (`adapters.ts:82-88`). Простое переименование `GitHubClient` даёт типы, но не даёт рантайм-дискриминатора, а `Container` обязан диспетчеризовать по строке из БД (`repos.vcs_provider`).

**Composition root неприкосновенен.** Все `new AzureDevOpsClient(...)` — исключительно в `platform/container.ts`. Сервисы получают клиента через `container.vcs(repo)`. Образец для кэширования — `llm(id)` с `Map` (`container.ts:213-245`), а не текущий одиночный `_github`.

**Слои.** Маппинг ADO-ответов → DTO живёт в `adapters/azure-devops/mappers.ts` (инфраструктура, чистые функции). Оркестрация — в сервисах модулей. Роуты остаются тонкими: валидация → один вызов сервиса → ответ. Ветвление по провайдеру **не должно** появляться в `routes.ts` — оно живёт в `Container.vcs()` и внутри реализаций порта.

**Валидация — стек, без дублирования.** HTTP-форма `POST /repos` (включая правило «`base_url` обязателен при `azure-devops`») — Zod в `repos/routes.ts`. Доменный инвариант «у ADO-репо обязан быть `project`» — обычный guard-clause с `ConfigError` в адаптере, **без** Zod. Валидация внешнего `properties['devdigest.findingId']` — на границе адаптера, до матчинга.

**Секреты только через контейнер.** `LocalSecretsProvider` — единственный читатель `process.env`. `AZURE_DEVOPS_TOKEN` запрашивается через инжектированный `SecretsProvider`, кэш сбрасывается через `invalidateSecretCaches()`.

**Общий diff-загрузчик вместо кросс-модульного импорта.** `pulls` не имеет права импортировать `reviews/diff-loader.ts` напрямую — это нарушение границ модулей. Загрузчик переезжает в `modules/_shared/diff/`, оба модуля зависят от общего кода, а не друг от друга. Прецедент подхода в проекте — общие репозитории как свойства `Container` (`server/insights/INSIGHTS.md:62,64`).

**Переиспользование, а не переписывание.** Парсер unified diff уже есть — `adapters/git/diff-parser.ts:14-79` (`parseUnifiedDiff`), используется и `SimpleGitClient.diff()`, и fallback-путём. Новый код — только тонкий `splitUnifiedDiffByFile` поверх него. Аналогично `withRetry` (`platform/resilience.ts:26-87`) не форкается: ADO-специфика подаётся через существующую опцию `isRetryable`.

**Слой git уже provider-agnostic.** `SimpleGitClient` клонирует любой переданный URL — аутентификация целиком embedded в сам URL, не в заголовки. Поэтому вся provider-специфика git-auth сосредоточена в одном билдере URL (`withVcsToken`), а не размазана по `GitClient`.

**Зафиксированный технический долг.** CI-методы (`listWorkflowRuns`, `downloadArtifact`) остаются на `VcsClient`, хотя их единственный потребитель — `modules/ci/` (2 точки вызова: `ci/service.ts:241`, `ci/service.ts:288`). Порт становится «дырявым»: ADO-реализация обязана бросать `not_supported` для методов, которых никто вне `ci/` не касается. Выделение отдельного порта `CiProvider` — чистое решение, **осознанно отложено** (решение Q2) до момента, когда Azure Pipelines реально понадобится. Причина отсрочки: рефакторинг без пользовательской ценности, раздувающий самую рискованную для регрессии GitHub фазу.
