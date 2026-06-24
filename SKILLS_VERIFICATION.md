# Skills Feature — Verification Checklist

Всё что нужно проверить вручную после реализации. Выполняй по порядку.

---

## 1. TypeScript typecheck

### Команды

```bash
cd server && pnpm typecheck
cd client && pnpm typecheck
```

### Ожидаемый результат

**Server:** только 9 старых ошибок в `run.repo.severity.test.ts` (TS18048 "possibly undefined") — они существовали до фичи, их НЕ трогать.

**Client:** 0 ошибок.

### Если есть лишние ошибки

Смотри на файл в котором ошибка — скорее всего это один из новых файлов Skills. Типичные проблемы:
- Импорт типа `Skill` / `SkillType` / `SkillSource` не из `@devdigest/shared`
- Хук возвращает `Skill | undefined` но компонент не проверяет на undefined
- `useSearchParams()` используется без `Suspense` обёртки в Next.js 15

---

## 2. База данных — seed

### Команда

```bash
cd server && pnpm db:seed
```

### Ожидаемый результат

```
✓ seeded { workspaceId: '...', userId: '...' }
```

Без ошибок. Idempotent — можно запускать несколько раз.

### Проверка через psql / SQL

```sql
SELECT name, type, enabled FROM skills ORDER BY created_at;
-- Ожидаем 6 строк:
-- PR Quality Rubric       | rubric     | true
-- No .then() Chains       | convention | true
-- Secret Leakage Gate     | security   | true
-- Lethal Trifecta         | security   | true
-- Phantom API Gate        | security   | true
-- Test Coverage Nudge     | custom     | true

SELECT name FROM agents ORDER BY created_at;
-- Ожидаем 3 агента:
-- General Reviewer
-- Security Reviewer
-- Test Quality Reviewer

SELECT a.name AS agent, s.name AS skill, aks.order
FROM agent_skills aks
JOIN agents a ON a.id = aks.agent_id
JOIN skills s ON s.id = aks.skill_id
ORDER BY a.name, aks.order;
-- Security Reviewer → PR Quality Rubric (0), Secret Leakage Gate (1), Lethal Trifecta (2)
-- Test Quality Reviewer → PR Quality Rubric (0), Test Coverage Nudge (1), No .then() Chains (2), Phantom API Gate (3)
```

---

## 3. API — curl проверка

Запусти сервер: `./scripts/dev.sh`

### 3.1 Список скилов

```bash
curl http://localhost:3001/skills | jq '.[].name'
```

Ожидаем 6 названий скилов.

### 3.2 Создание скила

```bash
curl -X POST http://localhost:3001/skills \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Skill","description":"desc","type":"custom","body":"# Test\n\nHello world."}' | jq .
```

Ожидаем 201 с полем `id`, `version: 1`.

### 3.3 Обновление body — должна вырасти версия

```bash
# Замени <ID> на id из предыдущего шага
curl -X PUT http://localhost:3001/skills/<ID> \
  -H "Content-Type: application/json" \
  -d '{"body":"# Updated body"}' | jq '{version, body}'
```

Ожидаем `version: 2`.

### 3.4 История версий

```bash
curl http://localhost:3001/skills/<ID>/versions | jq '.[].version'
```

Ожидаем `[2, 1]` (desc).

### 3.5 Restore версии

```bash
curl -X POST http://localhost:3001/skills/<ID>/restore \
  -H "Content-Type: application/json" \
  -d '{"version":1}' | jq '{version, body}'
```

Ожидаем `version: 3` с телом версии 1.

### 3.6 Статистика скила

```bash
curl http://localhost:3001/skills/<ID>/stats | jq .
```

Ожидаем:
```json
{
  "agent_count": 0,
  "pull_frequency_pct": 0,
  "accept_rate_pct": 0,
  "findings_30d": 0,
  "agents": [],
  "findings_by_category": {}
}
```

### 3.7 Агенты возвращают skill_count

```bash
curl http://localhost:3001/agents | jq '.[].skill_count'
```

Ожидаем три числа: `0` (General), `3` (Security), `4` (Test Quality).

### 3.8 Удаление

```bash
curl -X DELETE http://localhost:3001/skills/<ID> | jq .
```

Ожидаем `{"ok": true}`.

---

## 4. UI — ручная проверка в браузере

Открой `http://localhost:3000`

### 4.1 Skills page (`/skills`)

- [ ] Левая панель показывает 6 карточек скилов
- [ ] Поиск фильтрует карточки по названию
- [ ] Кнопка "+ Add Skill" открывает модал
- [ ] Модал → вкладка **Create**: ввести название, описание, тип, тело → Save → новый скил появляется в списке
- [ ] Модал → вкладка **Import**: загрузить .md файл → появляется превью тела → ввести название → Import → скил создан
- [ ] Клик на карточку → переход на `/skills/:id`

### 4.2 Skill editor — Config tab (`/skills/:id?tab=config`)

- [ ] Поля Name, Description, Type заполнены данными скила
- [ ] Тело отображается с номерами строк слева
- [ ] Счётчик токенов в правом верхнем углу
- [ ] Редактирование тела → появляется badge "unsaved"
- [ ] Кнопка Save → badge исчезает, версия увеличивается

### 4.3 Preview tab (`?tab=preview`)

- [ ] Тело скила отображается как читаемый текст (не редактируется)
- [ ] Для импортированного скила — badge "untrusted"

### 4.4 Stats tab (`?tab=stats`)

- [ ] 4 карточки: USED BY, PULL FREQUENCY, ACCEPT RATE, FINDINGS 30D
- [ ] Для Security Reviewer — USED BY показывает 1 (скил связан с агентом)
- [ ] Список агентов использующих скил
- [ ] Donut chart для findings by category (пустой если нет запусков)

### 4.5 Versions tab (`?tab=versions`)

- [ ] Список версий, текущая с меткой "● Current"
- [ ] Кнопка **Diff** разворачивает тело старой версии
- [ ] Кнопка **Restore** создаёт новую версию с телом старой

### 4.6 Agent editor — Skills tab (`/agents/:id`)

- [ ] В редакторе агента есть вкладка "Skills"
- [ ] Список всех скилов с чекбоксами
- [ ] Для Security Reviewer — 3 скила уже отмечены
- [ ] Снятие галочки → скил отвязывается (POST /agents/:id/skills)
- [ ] Перетаскивание строки → порядок меняется

### 4.7 Agent cards — skill_count

- [ ] На странице `/agents` карточки агентов показывают количество скилов
- [ ] Security Reviewer: 3 skills, Test Quality Reviewer: 4 skills, General Reviewer: 0

---

## 5. Пайплайн — скилы в промпте

### Проверка

1. Открой `/pulls/:id` на любом PR
2. Запусти **Security Reviewer** (у него 3 скила)
3. После завершения открой trace drawer (кнопка "Trace")
4. В секции **Prompt Assembly** должен быть блок `## Skills / rules`
5. Запусти **General Reviewer** (0 скилов) — блока `## Skills / rules` НЕ должно быть

---

## 6. Что доработать после проверки

| Проблема | Приоритет | Описание |
|----------|-----------|---------|
| `skills/layout.tsx` отсутствует | Низкий | Код левой панели дублируется в `/skills/page.tsx` и `/skills/[id]/page.tsx`. Не баг, можно рефакторить позже. |
| Stats на карточке скила | Средний | `GET /skills` возвращает `Skill[]` без `agent_count`. Либо расширить server endpoint до `listWithStats`, либо принять что карточки без статистики. |
| Импорт .zip — browser support | Низкий | `DecompressionStream` поддерживается Chrome 80+, Firefox 113+, Safari 16.4+. В старых браузерах не работает. Если нужна поддержка — добавить `fflate` как fallback. |
