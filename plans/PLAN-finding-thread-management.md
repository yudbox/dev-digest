# План: Управление thread'ом из карточки находки

> Status: DRAFT
> Created: 2026-09-02

## Контекст

Сейчас кнопка "Reply to author" создаёт тред в ADO и ставит `findings.replied_at`. На этом всё — карточка не знает `ado_thread_id`, поэтому нельзя читать ответы, отвечать в тот же тред, редактировать или удалять свои комментарии.

---

## Требования

| ID | Требование |
|----|-----------|
| R1 | После публикации комментария сохранять `ado_thread_id` и `ado_comment_id` в базу |
| R2 | Карточка находки умеет получать список комментариев из ADO (fetch по кнопке) |
| R3 | Из карточки можно опубликовать ответ в уже существующий тред (reply to reply) |
| R4 | Свои комментарии (определяются по автору) можно редактировать inline |
| R5 | Свои комментарии можно удалять |
| R6 | Политика English-only (`assertEnglishBody`) применяется и для ответов, и для редактирования |
| R7 | Удаление первого комментария треда запрещено, если в треде есть ответы других авторов — ADO это запрещает, ошибку показываем пользователю |

---

## Что меняется — по слоям

### Шаг 1 — DB: таблица `finding_replies`

Новая таблица вместо хранения thread id в `findings` (1 находка → N публикаций — при идемпотентном re-publish добавляется новый комментарий, не перезаписывается):

```
finding_replies
  id            uuid PK
  finding_id    uuid FK → findings.id
  ado_thread_id integer NOT NULL
  ado_comment_id integer NOT NULL
  body          text NOT NULL
  created_at    timestamptz
  updated_at    timestamptz
```

Drizzle schema + `pnpm db:generate` + `pnpm db:migrate`.

### Шаг 2 — ADO adapter: `threads.ts`

Добавить три функции (экспортировать из `publishThreadComment` уже есть):

- `getThread(ctx, threadId)` → GET `/threads/{threadId}` — возвращает `PrReviewComment[]` для конкретного треда
- `updateComment(ctx, threadId, commentId, body)` → PATCH `/threads/{threadId}/comments/{commentId}`
- `deleteComment(ctx, threadId, commentId)` → DELETE `/threads/{threadId}/comments/{commentId}`

`assertEnglishBody` вызывать в `updateComment`.

### Шаг 3 — Server: сохранять thread id + новые endpoints

**Изменить** `findings.ts` (`case "reply"`): после `publishComment` вставлять запись в `finding_replies` с полученным `thread_id` + `comment_id`.

**Новые роуты** в `reviews/routes.ts`:

```
GET    /findings/:id/replies           → читаем ado_thread_id из finding_replies, дёргаем getThread в ADO
POST   /findings/:id/replies           → addComment в существующий тред, сохраняем новую запись
PATCH  /findings/:id/replies/:replyId  → updateComment по ado_thread_id+ado_comment_id из finding_replies
DELETE /findings/:id/replies/:replyId  → deleteComment + удалить запись из finding_replies
```

`replyId` — UUID из `finding_replies` (не ADO id), чтобы не экспонировать внутренние ADO id наружу.

### Шаг 4 — Zod контракты

В `vendor/shared/contracts/findings.ts`:

```ts
export const FindingReply = z.object({
  id: z.string().uuid(),          // finding_replies.id
  body: z.string(),
  author: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  is_own: z.boolean(),            // true если автор = текущий пользователь
});

export const FindingRepliesResponse = z.object({
  replies: z.array(FindingReply),
  ado_thread_url: z.string().nullable(), // ссылка на тред в ADO
});
```

`is_own` — сервер определяет сравнением `comment.author.uniqueName` с email пользователя из workspace/сессии.

### Шаг 5 — Client UI

На карточке находки под кнопкой "Reply to author" — раскрывающийся Thread блок:

- **Кнопка ↻ Refresh** — `GET /findings/:id/replies`, обновляет список
- **Список комментариев**: автор, время, текст. На `is_own` комментариях — иконки ✎ Edit и ✕ Delete
- **Edit** — inline textarea с текущим телом + кнопка Save → `PATCH`
- **Delete** — confirm-диалог → `DELETE`
- **Reply box** — textarea + Send → `POST /findings/:id/replies`

Состояние: `useQuery` для списка с ручным `refetch`, `useMutation` для каждого действия с инвалидацией.

---

## Файлы

| Файл | Изменение |
|------|-----------|
| `server/drizzle/…_finding_replies.sql` | NEW — миграция |
| `server/src/db/schema.ts` | +findingReplies таблица |
| `server/src/adapters/azure-devops/threads.ts` | +getThread, +updateComment, +deleteComment |
| `server/src/modules/reviews/repository.ts` | +CRUD для finding_replies |
| `server/src/modules/reviews/findings.ts` | reply action сохраняет thread id |
| `server/src/modules/reviews/routes.ts` | 4 новых endpoint |
| `server/src/vendor/shared/contracts/findings.ts` | +FindingReply, +FindingRepliesResponse |
| `client/src/components/FindingCard/` | Thread секция + хуки |
| `client/src/lib/api/findings.ts` | API клиент для новых endpoints |

---

## Порядок выполнения

1. Шаг 1 (DB) — блокирующий, всё остальное зависит от него
2. Шаги 2–4 параллельно (adapter + endpoints + contracts)
3. Шаг 5 (UI) — последним, после того как endpoints задокументированы

---

## Ограничения (ADO)

- `properties` у треда **иммутабельны** после создания — не трогаем при update/delete
- Удалить первый комментарий треда, если есть ответы, ADO не даст (400) — показываем понятную ошибку
- `updateThread` без поля `properties` в теле — безопасно (подтверждено в TASK-008)
