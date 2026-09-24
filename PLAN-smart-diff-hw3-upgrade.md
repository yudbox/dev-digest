# План: підтягнути dev-digest під новий текст ДЗ3 (Smart Diff + дрібниці Intent Layer)

## Контекст

Порівняння dev-digest (гілка main) проти оновленого criterias_hw3.md (47 критеріїв) показало, що сам еталонний проєкт відстав від тексту ДЗ, який зараз видається студентам: Smart Diff у коді все ще на старій 3-ролевій версії (core/wiring/boilerplate) з навігацією на вкладку Findings по кліку, тоді як новий текст вимагає 5 ролей, індикатори без переходу між вкладками та інлайн-картку знахідки прямо під рядком коду. Мета — привести код у відповідність новому тексту, щоб dev-digest знову міг слугувати еталоном при перевірці студентів, і заразом закрити пару дрібних розбіжностей у вже готовому Intent Layer.

Дослідження підтвердило, що всі потрібні перевикористовувані шматки вже існують у кодовій базі (хуки, токени кольорів, adapter для читання файлів) — план нижче свідомо переиспользує їх, а не пише щось із нуля.

Пріоритет: спочатку Smart Diff (перекриває більшість P1/P2 розбіжностей), потім агенти (закриває P1 прогалину з ролями), потім дрібні Intent Layer правки (P2/P3, менш критично).

---

## Фаза 1 — Контракт: 5 ролей SmartDiffRole

Файли: server/src/vendor/shared/contracts/brief.ts, client/src/vendor/shared/contracts/brief.ts (обидві копії мають лишитись ідентичними).

- Розширити SmartDiffRole = z.enum(["core","tests","wiring","docs","boilerplate"]) в обох файлах.
- Решта схеми (SmartDiffFile, SmartDiffGroup, SmartDiff) вже generic над role — змін не потребує.

## Фаза 2 — Класифікатор (сервер, чиста логіка + тести)

Файли: server/src/modules/pulls/classifier-patterns.ts, server/src/modules/pulls/classifier.ts, server/src/modules/pulls/classifier.test.ts.

- classifier-patterns.ts: додати TESTS_PATTERNS і DOCS_PATTERNS, звірити існуючі BOILERPLATE_PATTERNS/WIRING_PATTERNS зі списком з тексту ДЗ (*.lock, dist/**, build/**, __snapshots__/**, *.snap, *.generated.*, *.min.js для boilerplate; *.test.ts(x), *.it.test.ts, *.spec.ts, test/**, tests/**, __tests__/**, e2e/** для tests; додати .claude/**, .env*, docker-compose*.yml, .eslintrc*, tsconfig*.json до wiring; **/*.md, docs/**, README*, CHANGELOG*, LICENSE для docs).
- classifier.ts: classifyFile перевіряє патерни в порядку boilerplate → tests → wiring → docs → core (перше збігання виграє, core — catch-all); classifyFile лишається чистою функцією без HTTP-залежностей (вже так, просто зберегти інваріант); ROLE_ORDER для виводу груп — ["core","tests","wiring","docs","boilerplate"] (порядок відображення відрізняється від порядку перевірки).
- classifier.test.ts: додати таблицю «шлях → роль», включно з 3 спірними кейсами з тексту ДЗ: __tests__/__snapshots__/x.snap → boilerplate, .claude/skills/security/SKILL.md → wiring, e2e/README.md → tests.

server/src/modules/pulls/service.ts вже будує групи через generic ROLE_ORDER/byRole Map і бере finding_lines з f.startLine — змін не потребує, запрацює автоматично після Фаз 1–2.

## Фаза 3 — i18n

Файл: client/messages/en/prReview.json (ключ smartDiff).

- Додати testsLabel/testsDesc, docsLabel/docsDesc за зразком існуючих coreLabel/coreDesc.

## Фаза 4 — SmartDiffViewer.tsx (рівень групи)

Файл: client/src/components/smart-diff/SmartDiffViewer.tsx.

- Додати кольори для tests/docs у ROLE_DOT.
- У заголовку групи (GroupSection) порахувати filesWithFindings = files.filter(f => f.finding_lines.length > 0).length і рендерити "● {filesWithFindings}" перед "{group.files.length} files", коли filesWithFindings > 0.
- Розширити умову згортання за замовчуванням: isCollapsedByDefault = role === "boilerplate" || role === "docs" (замість лише boilerplate); зберегти існуючий override «розгорнути, якщо є findings» для обох цих ролей.

## Фаза 5 — FileCard.tsx (рівень файлу)

Файл: client/src/components/diff-viewer/FileCard/FileCard.tsx.

- Додати окрему кольорову крапку без числа біля шляху файлу, коли у файлу є хоч одна знахідка — не чіпаючи існуючі severityGroups-чипи (лишаються як є, це вже наявна фіча) і не плутаючи з іконкою лічильника GitHub-коментарів.

## Фаза 6 — Інлайн-картка знахідки під рядком (найбільша зміна)

Нові/змінювані файли:
- Новий client/src/components/diff-viewer/InlineFindingCard/InlineFindingCard.tsx — проста презентаційна картка (НЕ перевикористовує важкий FindingCard зі сторінки Agent runs — той має вбудовані хуки реплаїв і глибокі відносні імпорти, непридатний для прямого перевикористання поза своєю теки). Замість цього:
  - Кольори/іконка severity — з SEV (client/src/vendor/ui/primitives/tokens.ts) і SeverityBadge (.../Badge.tsx), а не власна палітра.
  - Контент: title, rationale, suggestion з повного об'єкта Finding.
  - Кнопки Accept/Dismiss через useFindingAction() (client/src/lib/hooks/reviews.ts:143) — виклик action.mutate({ findingId, action: "accept"|"dismiss", prId }), той самий патерн що й у FindingsPanel.tsx.
- client/src/components/diff-viewer/CodeLine/CodeLine.tsx: прибрати клік-навігацію (router.push на ?tab=findings), лишити колоровану смужку/бейдж на рядку (через SEV[severity].c, а не локальні BADGE_STYLE/BADGE_LABEL) як клікабельний перемикач: локальний useState expanded (за замовчуванням false — картка згорнута/невидима); клік по бейджу/маркеру рядка перемикає expanded, і лише тоді під рядком рендериться InlineFindingCard (акордеон, розгортання на місці — без переходу на іншу сторінку/вкладку). Видимість самого бейджа-маркера (сам факт, що на рядку є знахідка) керується commenting.showComments (наявний boolean з DiffCommentApi, comments.ts:8) — тим самим прапорцем, що вже ховає/показує GitHub-коментарі (закриває окремий критерій на «спільний toggle»); стан expanded картки — окремий, локальний до кожного рядка.
- CodeLine/FileCard мають отримувати повний об'єкт Finding (title/rationale/suggestion), а не легку форму line_findings з /smart-diff — джерело даних змінюється (див. Фазу 7).
- У FileCard.tsx: знахідки файлу, чий start_line не потрапив у відрендерені рядки (parsePatch), показати окремим блоком InlineFindingCard в кінці тіла файлу, а не приховувати.

## Фаза 7 — DiffTab.tsx: підключення usePrReviews

Файл: client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx.

- Додати const { data: reviews } = usePrReviews(prId) (client/src/lib/hooks/reviews.ts:57, повертає повні ReviewRecord[] з title/rationale/suggestion — саме те, чого бракує в легкому line_findings).
- Побудувати мапу file → line → Finding (по аналогії з тим, як PullsService.buildSmartDiff вже робить це на сервері: найсерйозніший severity на рядок, приховувати dismissed, позначати accepted), передати новим пропом і в SmartDiffViewer, і в звичайний DiffViewer — обидва виклики вже отримують однаковий commenting-проп поруч (рядки виклику в DiffTab.tsx), новий проп додається туди ж.

## Фаза 8 — Агенти: закрити ролі brainstorm + security-reviewer

Файли: нові .claude/agents/security-reviewer.md, .claude/agents/brainstorm.md.

- security-reviewer.md: read-only tools (Read, Grep, Glob, Bash, Skill, без Write/Edit — за зразком наявного architecture-reviewer.md), опис — пошук експлуатованих проблем + виставлення severity. Підключити наявний skill "security" з .claude/skills/security/ (той самий, що вже підключений в architecture-reviewer.md/implementer.md/quick-planner.md/spec-creator.md) — новий skill створювати не треба.
- brainstorm.md: опис — порівнює підходи/варіанти до реалізації, не пише код. Без skills:, read-only, за зразком researcher.md.
- Рішення: додаються як 2 нові файли (агентів стає 11), наявні implementation-planner.md/quick-planner.md/spec-creator.md не чіпаються — найменший ризик, не ламає нічого наявного.

## Фаза 9 — Дрібні правки Intent Layer (нижчий пріоритет, окремо від Smart Diff)

Файли: server/src/modules/reviews/intent-deriver.ts, server/src/modules/reviews/run-executor.ts.

- У intent-deriver.ts, поруч із наявним runLog.info про оцінку токенів, додати лог обраної моделі (model, вже доступна в скоупі функції).
- У run-executor.ts, поруч із наявним парсингом Closes/Fixes/Resolves #N, додати розпізнавання посилання на файл плану/специфікації в тілі PR (напр. регексп на specs/PLAN-[\w-]+\.md чи plans/PLAN-[\w-]+\.md) і читання його вмісту через GitClient.readFile(repo, path) (server/src/adapters/git/simple-git.ts:282 — читає з уже клонованої локальної копії, тому спрацює лише після існуючого кроку sync/fetch голови PR).
- При невдалому фетчі (issue або план) — не просто мовчки runLog.info(...skipping), а додатково передати позначку в deriveIntent, щоб фінальний Intent, який бачить користувач, explicit згадував брак контексту (а не просто тихо продовжував).

Свідомо не входить у цей план: дедуплікація/фільтрація знахідок за in_scope/out_of_scope (контрольний експеримент з тексту лабораторної). Дослідження показало, що чистого місця для цього немає — reduceReviews у reviewer-core/src/review/reduce.ts отримує лише вже відформатований intent-рядок, а не структуровані масиви in_scope/out_of_scope; єдиний існуючий агрегаційний прохід (server/src/modules/reviews/aggregate-service.ts) — окремий, опційний LLM-виклик, що нічого не персистить. Щоб зробити це деструктивно (детерміновано, не через LLM), треба або прокинути структурований Intent у RunInput замість рядка, або додати новий крок — це окрема архітектурна зміна, варта окремого обговорення, а не пункту в цьому плані.

---

## Верифікація

- cd server && pnpm exec vitest run src/modules/pulls/classifier.test.ts — нова таблиця «шлях → роль» і 3 спірні кейси зелені.
- cd server && pnpm exec vitest run / cd client && pnpm exec vitest run — існуючі тести (intent-deriver.test.ts і т.д.) не зламані.
- Вручну в браузері (pnpm dev в server і client): відкрити тестовий PR → вкладка Files changed → перевірити 5 груп у порядку core→tests→wiring→docs→boilerplate з підписами й лічильниками; docs/boilerplate згорнуті; лічильник ●N на групі після Run Review; крапка на картці файлу; розгорнути файл → побачити кольоровий маркер на рядку зі знахідкою → клік по ньому розгортає інлайн-картку на місці (без переходу на іншу вкладку), з робочими Accept/Dismiss; повторний клік згортає картку назад; перемкнути Original order і назад; сховати/показати коментарі — знахідки ховаються разом з ними.
- git diff по обох копіях brief.ts — переконатися, що вони лишились ідентичними після Фази 1.
