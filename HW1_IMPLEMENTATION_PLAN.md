# HW1 — Conventions Extractor + API Contract Reviewer
## Повний план реалізації

---

## Що будуємо

**Дві речі:**

1. **Conventions Extractor** — нова сторінка `/conventions` де DevDigest аналізує твій репозиторій, знаходить неписані правила кодстайлу через LLM, дозволяє тобі їх прийняти або відхилити, і перетворює прийняті правила на скіл для агента.

2. **API Contract Reviewer** — новий агент у seed.ts з 4 скілами, які вчать агента знаходити breaking API changes у PR.

---

## Що вже є (не чіпаємо)

| Що | Де | Навіщо знати |
|----|----|-------------|
| Таблиця `conventions` у DB | `server/src/db/schema/knowledge.ts:31` | Є, але треба додати `createdAt` |
| Тип `ConventionCandidate` | `server/src/vendor/shared/contracts/knowledge.ts:144` | Використовуємо як DTO |
| Метод `repoIntel.getConventionSamples(repoId, n)` | `server/src/modules/repo-intel/service.ts` | Повертає топ-N файлів за рейтингом |
| Метод `llm.completeStructured<T>()` | `server/src/adapters/llm/openai.ts:88` | Виклик LLM з JSON-схемою відповіді |
| `container.llm(provider)` | `server/src/platform/container.ts` | Отримати LLM провайдер |
| `SkillsService.create()` | `server/src/modules/skills/service.ts:69` | Створити скіл з конвенцій |
| `POST /skills/import` | `server/src/modules/skills/routes.ts` | Вже є — для URL import додамо окремий роут |
| `activeKeyFor('/skills')` | `client/src/components/app-shell/helpers.ts:33` | Патерн для додавання `/conventions` |

---

## ЧАСТИНА 1 — SERVER

---

### Крок 1.1 — Оновити схему DB

**Файл:** `server/src/db/schema/knowledge.ts`

Знайди таблицю `conventions` (рядок 31) і додай `createdAt`:

```ts
// БУЛО:
export const conventions = pgTable('conventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
  rule: text('rule').notNull(),
  evidencePath: text('evidence_path'),
  evidenceSnippet: text('evidence_snippet'),
  confidence: doublePrecision('confidence'),
  accepted: boolean('accepted').notNull().default(false),
});

// СТАЛО — додати createdAt в кінець:
export const conventions = pgTable('conventions', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
  rule: text('rule').notNull(),
  evidencePath: text('evidence_path'),
  evidenceSnippet: text('evidence_snippet'),
  confidence: doublePrecision('confidence'),
  accepted: boolean('accepted').notNull().default(false),
  createdAt: now(),  // ← ДОДАТИ ЦЕЙ РЯДОК
});
```

Після зміни схеми — генеруємо і застосовуємо міграцію:

```bash
cd server && pnpm db:generate && pnpm db:migrate
```

---

### Крок 1.2 — Додати ConventionRow тип

**Файл:** `server/src/db/rows.ts`

Додай в кінець файлу:

```ts
export type ConventionRow = typeof t.conventions.$inferSelect;
```

---

### Крок 1.3 — Створити модуль conventions

Створи директорію і 4 файли:

```
server/src/modules/conventions/
  repository.ts
  extractor.ts
  service.ts
  routes.ts
```

---

#### `server/src/modules/conventions/repository.ts`

```ts
import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow } from '../../db/rows.js';
export type { ConventionRow };

export class ConventionsRepository {
  constructor(private db: Db) {}

  /** Всі конвенції репо: accepted першими, потім по confidence desc */
  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    const rows = await this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
        ),
      );
    return rows.sort((a, b) => {
      if (a.accepted !== b.accepted) return a.accepted ? -1 : 1;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
  }

  /**
   * Re-scan: видаляємо всі старі конвенції репо і вставляємо нові.
   * Так при кожному скані маємо свіжі результати.
   */
  async replaceAll(
    workspaceId: string,
    repoId: string,
    candidates: Array<{
      rule: string;
      evidencePath: string;
      evidenceSnippet: string;
      confidence: number;
    }>,
  ): Promise<ConventionRow[]> {
    // Видаляємо старі
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
        ),
      );

    if (candidates.length === 0) return [];

    // Вставляємо нові
    const rows = await this.db
      .insert(t.conventions)
      .values(
        candidates.map((c) => ({
          workspaceId,
          repoId,
          rule: c.rule,
          evidencePath: c.evidencePath,
          evidenceSnippet: c.evidenceSnippet,
          confidence: c.confidence,
          accepted: false,
        })),
      )
      .returning();

    return rows;
  }

  /** Accept: позначаємо як прийняту */
  async accept(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ accepted: true })
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.id, id),
        ),
      )
      .returning();
    return row;
  }

  /** Reject = фізично видаляємо (не зберігаємо rejected стан) */
  async reject(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.id, id),
        ),
      )
      .returning({ id: t.conventions.id });
    return rows.length > 0;
  }

  /** Inline edit: оновити текст правила */
  async updateRule(workspaceId: string, id: string, rule: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ rule })
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.id, id),
        ),
      )
      .returning();
    return row;
  }

  /** Тільки accepted — для створення скіла */
  async listAccepted(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.accepted, true),
        ),
      );
  }
}
```

---

#### `server/src/modules/conventions/extractor.ts`

```ts
import { readFile } from 'fs/promises';
import { join } from 'path';
import { z } from 'zod';
import type { LLMProvider } from '@devdigest/shared';

// Zod схема для відповіді LLM
const ExtractionSchema = z.object({
  candidates: z.array(
    z.object({
      rule: z.string(),
      evidence_path: z.string(),
      evidence_snippet: z.string(),
      confidence: z.number().min(0).max(1),
    }),
  ),
});

/** Читає файл з диску. Повертає null якщо файл не знайдено. Обрізає до 2000 символів. */
async function readSample(clonePath: string, relativePath: string): Promise<string | null> {
  try {
    const content = await readFile(join(clonePath, relativePath), 'utf-8');
    return content.slice(0, 2_000);
  } catch {
    return null;
  }
}

/**
 * Верифікація доказів після LLM.
 * Перевіряємо що файл реально існує і перший рядок сніппета є у файлі.
 * Кандидати без реальних доказів відкидаються.
 */
async function verifyEvidence(
  clonePath: string,
  evidencePath: string,
  evidenceSnippet: string,
): Promise<boolean> {
  try {
    const fullPath = join(clonePath, evidencePath);
    const content = await readFile(fullPath, 'utf-8');
    const firstLine = evidenceSnippet.split('\n')[0]?.trim() ?? '';
    return firstLine.length > 0 && content.includes(firstLine);
  } catch {
    // Файл не існує — відкидаємо кандидата
    return false;
  }
}

export interface ExtractedCandidate {
  rule: string;
  evidencePath: string;
  evidenceSnippet: string;
  confidence: number;
}

/**
 * Основна функція екстракції:
 * 1. Читає конфіги (eslint, tsconfig, prettier) — без LLM
 * 2. Читає топ-12 файлів репо
 * 3. Викликає gpt-4.1-mini для аналізу
 * 4. Верифікує доказательства кодом
 * 5. Повертає тільки валідні кандидати
 */
export async function extractConventions(opts: {
  clonePath: string;
  samplePaths: string[];
  repoName: string;
  llm: LLMProvider;
}): Promise<ExtractedCandidate[]> {
  const { clonePath, samplePaths, repoName, llm } = opts;

  // Конфіги — читаємо кодом, без LLM
  const configFiles = [
    '.eslintrc.js', '.eslintrc.json', '.eslintrc', '.eslintrc.cjs',
    'tsconfig.json', 'tsconfig.base.json',
    '.prettierrc', '.prettierrc.json', '.prettierrc.js',
    'biome.json', '.editorconfig',
  ];

  const configContents: string[] = [];
  for (const cfg of configFiles) {
    const content = await readSample(clonePath, cfg);
    if (content) {
      configContents.push(`--- ${cfg} ---\n${content}`);
    }
  }

  // Топ-12 файлів репо
  const sampleContents: string[] = [];
  for (const path of samplePaths.slice(0, 12)) {
    const content = await readSample(clonePath, path);
    if (content) {
      sampleContents.push(`--- ${path} ---\n${content}`);
    }
  }

  const allSamples = [...configContents, ...sampleContents].join('\n\n');

  if (allSamples.trim().length === 0) {
    return [];
  }

  // Виклик LLM
  const result = await llm.completeStructured({
    model: 'gpt-4.1-mini',
    schema: ExtractionSchema,
    schemaName: 'ConventionsExtraction',
    messages: [
      {
        role: 'system',
        content: `You are a code-convention analyst. Analyze the provided code samples and extract concrete coding conventions that are consistently followed in this repository.

Return ONLY conventions that:
1. Have clear evidence in the provided files
2. Can be formulated as a specific, actionable rule (start with "Always...", "Never...", "Use X instead of Y...")
3. Appear in at least 2 places or are configured explicitly
4. Would be useful for a code reviewer to enforce

Do NOT include:
- Generic best practices obvious to any TypeScript developer
- Things with only 1 example unless it's in a config file
- Framework defaults`,
      },
      {
        role: 'user',
        content: `Repository: ${repoName}

Analyze these files and extract coding conventions:

${allSamples}

Return JSON with a "candidates" array. Each candidate:
- rule: specific actionable rule in imperative form
- evidence_path: relative file path where you found this convention
- evidence_snippet: exact code snippet (2–5 lines) demonstrating the rule
- confidence: 0.0–1.0

Only include conventions with confidence > 0.6.`,
      },
    ],
    temperature: 0.2,
    maxTokens: 2048,
  });

  // Верифікація доказів — відкидаємо кандидатів без реальних файлів
  const verified: ExtractedCandidate[] = [];
  for (const c of result.data.candidates) {
    const valid = await verifyEvidence(clonePath, c.evidence_path, c.evidence_snippet);
    if (valid) {
      verified.push({
        rule: c.rule,
        evidencePath: c.evidence_path,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
      });
    }
  }

  return verified;
}
```

---

#### `server/src/modules/conventions/service.ts`

```ts
import { eq } from 'drizzle-orm';
import type { Container } from '../../platform/container.js';
import type { ConventionCandidate, Skill } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import { ConventionsRepository } from './repository.js';
import { extractConventions } from './extractor.js';
import { SkillsService } from '../skills/service.js';
import type { ConventionRow } from './repository.js';

function toDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    rule: row.rule,
    evidence_path: row.evidencePath ?? '',
    evidence_snippet: row.evidenceSnippet ?? '',
    confidence: row.confidence ?? 0,
    accepted: row.accepted,
  };
}

export class ConventionsService {
  private repo: ConventionsRepository;
  private skills: SkillsService;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
    this.skills = new SkillsService(container);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return rows.map(toDto);
  }

  async extract(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    // Завантажуємо репо щоб отримати clonePath і назву
    const [repoRow] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, repoId));

    if (!repoRow) throw new Error('Repository not found');
    if (!repoRow.clonePath) throw new Error('Repository not cloned — clone it first');

    // Топ-12 файлів через repoIntel
    const samplePaths = await this.container.repoIntel.getConventionSamples(repoId, 12);

    // LLM провайдер (openai)
    const llm = await this.container.llm('openai');

    const candidates = await extractConventions({
      clonePath: repoRow.clonePath,
      samplePaths,
      repoName: repoRow.name,
      llm,
    });

    // Зберігаємо в DB (видаляємо старі, вставляємо нові)
    const rows = await this.repo.replaceAll(workspaceId, repoId, candidates);
    return rows.map(toDto);
  }

  async accept(workspaceId: string, id: string): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.accept(workspaceId, id);
    return row ? toDto(row) : undefined;
  }

  async reject(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.reject(workspaceId, id);
  }

  async updateRule(workspaceId: string, id: string, rule: string): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.updateRule(workspaceId, id, rule);
    return row ? toDto(row) : undefined;
  }

  /**
   * Створює скіл з усіх accepted конвенцій.
   * Формат тіла: markdown з кожною конвенцією як секцією.
   */
  async createSkillFromAccepted(
    workspaceId: string,
    repoId: string,
    skillName: string,
    skillDescription: string,
  ): Promise<Skill> {
    const [repoRow] = await this.container.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.id, repoId));

    const accepted = await this.repo.listAccepted(workspaceId, repoId);
    if (accepted.length === 0) throw new Error('No accepted conventions to create skill from');

    const repoName = repoRow?.name ?? 'repo';

    // Будуємо тіло скіла у markdown
    const sections = accepted.map((c) => {
      const snippetBlock = c.evidenceSnippet
        ? `\nDetected in \`${c.evidencePath}\`:\n\`\`\`\n${c.evidenceSnippet}\n\`\`\``
        : '';
      return `## ${c.rule}${snippetBlock}`;
    });

    const body = [
      `# ${skillName}`,
      '',
      `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite the offending \`file:line\`.`,
      '',
      ...sections,
    ].join('\n\n');

    return this.skills.create(workspaceId, {
      name: skillName,
      description: skillDescription,
      type: 'convention',
      source: 'extracted',
      body,
      enabled: true,
    });
  }
}
```

---

#### `server/src/modules/conventions/routes.ts`

```ts
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { getContext } from '../_shared/context.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

const RepoParams = z.object({ repoId: z.string().uuid() });
const ConventionParams = z.object({ repoId: z.string().uuid(), id: z.string().uuid() });

// PATCH body: можна передати accepted і/або rule — або разом, або окремо
const PatchBody = z.object({
  accepted: z.boolean().optional(),
  rule: z.string().min(1).optional(),
});

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();

  /** POST /repos/:repoId/conventions/extract — запустити екстракцію */
  app.post(
    '/repos/:repoId/conventions/extract',
    { schema: { params: RepoParams } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ConventionsService(app.container);
      const candidates = await service.extract(workspaceId, req.params.repoId);
      reply.status(201);
      return candidates;
    },
  );

  /** GET /repos/:repoId/conventions — список конвенцій */
  app.get(
    '/repos/:repoId/conventions',
    { schema: { params: RepoParams } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ConventionsService(app.container);
      return service.list(workspaceId, req.params.repoId);
    },
  );

  /**
   * PATCH /repos/:repoId/conventions/:id
   * { accepted: true }  → прийняти
   * { accepted: false } → відхилити (видалити)
   * { rule: "..." }     → оновити текст правила (inline edit)
   */
  app.patch(
    '/repos/:repoId/conventions/:id',
    { schema: { params: ConventionParams, body: PatchBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ConventionsService(app.container);
      const { id } = req.params;
      const { accepted, rule } = req.body;

      // Inline edit правила
      if (rule !== undefined) {
        const result = await service.updateRule(workspaceId, id, rule);
        if (!result) throw new NotFoundError('Convention not found');
        return result;
      }

      // Accept
      if (accepted === true) {
        const result = await service.accept(workspaceId, id);
        if (!result) throw new NotFoundError('Convention not found');
        return result;
      }

      // Reject = видалити
      if (accepted === false) {
        const ok = await service.reject(workspaceId, id);
        if (!ok) throw new NotFoundError('Convention not found');
        return { ok: true };
      }

      throw new NotFoundError('Nothing to update');
    },
  );

  /** POST /repos/:repoId/conventions/skill — створити скіл з accepted */
  app.post(
    '/repos/:repoId/conventions/skill',
    { schema: { params: RepoParams, body: CreateSkillBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const service = new ConventionsService(app.container);
      const skill = await service.createSkillFromAccepted(
        workspaceId,
        req.params.repoId,
        req.body.name,
        req.body.description,
      );
      reply.status(201);
      return skill;
    },
  );
}
```

---

### Крок 1.4 — URL Import з захистом від атак

**Файл:** `server/src/modules/skills/routes.ts`

Додай новий роут **перед** `/skills/import` (щоб Fastify не переплутав шляхи):

```ts
import { BadRequestError } from '../../platform/errors.js';

// Додати в кінець skillsRoutes функції, перед закриваючою дужкою:

const ImportUrlBody = z.object({
  url: z.string().url(),
  name: z.string().min(1),
  source: SkillSource.optional(),
  description: z.string().optional(),
});

app.post('/skills/import-url', { schema: { body: ImportUrlBody } }, async (req, reply) => {
  const { workspaceId } = await getContext(app.container, req);
  const body = await safeFetchSkillUrl(req.body.url);
  const skill = await service.import(workspaceId, {
    name: req.body.name,
    body,
    source: req.body.source ?? 'imported_url',
    description: req.body.description,
  });
  reply.status(201);
  return skill;
});
```

**Додати функцію `safeFetchSkillUrl` у той самий файл (або окремий helper):**

```ts
/**
 * Безпечний fetch URL для імпорту скіла.
 * Захист від: SSRF, великих файлів, таймаутів, бінарників, HTTP downgrade.
 */
async function safeFetchSkillUrl(url: string): Promise<string> {
  // 1. Тільки HTTPS
  if (!url.startsWith('https://')) {
    throw new BadRequestError('Only HTTPS URLs are allowed');
  }

  // 2. SSRF захист — блокуємо приватні IP та localhost
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new BadRequestError('Invalid URL');
  }

  const PRIVATE_IP = /^(localhost|127\.|0\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;
  if (PRIVATE_IP.test(hostname)) {
    throw new BadRequestError('Private and local URLs are not allowed');
  }

  // 3. Fetch з таймаутом 10 секунд
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Network error';
    throw new BadRequestError(`Failed to fetch URL: ${msg}`);
  }

  if (!res.ok) {
    throw new BadRequestError(`URL returned HTTP ${res.status}`);
  }

  // 4. Тільки текстовий контент
  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.startsWith('text/')) {
    throw new BadRequestError('URL must return text content (text/plain or text/markdown)');
  }

  // 5. Ліміт розміру 100KB — читаємо потоком
  const MAX_BYTES = 100_000;
  const reader = res.body?.getReader();
  if (!reader) throw new BadRequestError('No response body');

  let total = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new BadRequestError('File too large (max 100KB)');
    }
    chunks.push(value);
  }

  return new TextDecoder().decode(Buffer.concat(chunks));
}
```

**Що це захищає:**

| Загроза | Захист |
|---------|--------|
| SSRF — запит до localhost або внутрішніх сервісів | Перевірка hostname по regex |
| Crash сервера від гігантського файлу | Стрімінг з лімітом 100KB |
| Зависання якщо хост не відповідає | AbortSignal.timeout(10_000) |
| Завантаження бінарників або HTML сторінок | Перевірка Content-Type |
| HTTP downgrade атаки | Тільки `https://` |

---

### Крок 1.5 — Зареєструвати плагін

**Файл:** `server/src/modules/index.ts`

Додай по патерну інших модулів:

```ts
import conventions from './conventions/routes.js';  // ← додати

// У масив плагінів:
conventions,  // ← додати
```

---

### Крок 1.6 — Seed: API Contract Reviewer

**Файл:** `server/src/db/seed.ts`

Додай в кінець функції `seed()` перед `return { workspaceId, userId }`:

```ts
// ---- API Contract Reviewer skills ----
const apiSkills = [
  {
    slug: 'breaking-change',
    values: {
      workspaceId,
      name: 'breaking-change',
      description: 'Detects removal or renaming of public API contracts without version bump.',
      type: 'security' as const,
      source: 'manual' as const,
      body: `# Breaking Change Gate

Flag any diff that removes, renames, or changes the type of a public API element without a version bump.

**Flag as CRITICAL if the diff:**
- Removes a public endpoint without prior deprecation notice
- Renames a field in a request or response body
- Changes a field from optional to required
- Changes a field's type (string → number, array → object)
- Removes a query or path parameter

**Good — additive change (safe):**
\`\`\`ts
type UserResponse = { id: string; name: string; email?: string }
\`\`\`

**Bad — breaking removal:**
\`\`\`ts
type UserResponse = { id: string }  // removed name and email
\`\`\`

Cite file:line and explain what downstream callers will break.`,
      enabled: true,
      version: 1,
    },
  },
  {
    slug: 'response-schema',
    values: {
      workspaceId,
      name: 'response-schema',
      description: 'Enforces backwards-compatible response schema changes only.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: `# Response Schema Discipline

Enforce that response schemas only change in backwards-compatible ways.

**Allowed without version bump:**
- Adding new OPTIONAL fields to a response
- Making a required field optional (wider)

**NOT allowed without version bump — flag as WARNING:**
- Removing existing fields from a response
- Making an optional field required (narrower)
- Changing a field's type
- Changing a field from nullable to non-nullable

**Check:** TypeScript interface/type changes in files under src/api/, src/routes/, or any file exporting a response schema.

**Bad example:**
\`\`\`ts
// Before
type Item = { id: string; price: number; discount?: number }
// After (breaking — removed discount)
type Item = { id: string; price: number }
\`\`\``,
      enabled: true,
      version: 1,
    },
  },
  {
    slug: 'semver-discipline',
    values: {
      workspaceId,
      name: 'semver-discipline',
      description: 'Flags breaking API changes without a corresponding major version bump.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: `# SemVer Discipline

Flag when a breaking API change is merged without a major version bump.

**MAJOR bump required:**
- Any breaking change to a public endpoint
- Removal of an endpoint or resource
- Change in authentication scheme

**MINOR bump sufficient:**
- New endpoints added
- New optional fields in requests/responses
- New query parameters (optional)

**PATCH sufficient:**
- Bug fixes that don't change API shape
- Performance improvements

**How to check:** Look for changes in package.json version field, openapi.yaml, or API version constants. If there is a breaking change but no major version bump — flag as WARNING.`,
      enabled: true,
      version: 1,
    },
  },
  {
    slug: 'deprecation-policy',
    values: {
      workspaceId,
      name: 'deprecation-policy',
      description: 'Enforces deprecate-first policy before removing any public API element.',
      type: 'convention' as const,
      source: 'manual' as const,
      body: `# Deprecation Policy

Never silently remove a public API element. Always deprecate first, then remove in a future major version.

**Correct deprecation cycle:**
1. v1.x → Add @deprecated JSDoc + runtime warning log
2. v2.0 → Remove the deprecated element

**Flag as WARNING if the diff:**
- Removes an endpoint without a prior @deprecated marker in the codebase
- Removes a field without documenting the removal in CHANGELOG
- Deletes a route handler without a redirect or 410 Gone response

**Good pattern:**
\`\`\`ts
/**
 * @deprecated Use /v2/users instead. Scheduled for removal in v3.0.
 */
app.get('/v1/users', deprecationMiddleware('/v2/users'), handler);
\`\`\`

**Bad pattern:**
\`\`\`ts
// Route just deleted with no notice to consumers
\`\`\``,
      enabled: true,
      version: 1,
    },
  },
];

const apiSkillIds = new Map<string, string>();
for (const { slug, values } of apiSkills) {
  let [existing] = await db
    .select()
    .from(t.skills)
    .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.name, values.name)));
  if (!existing) {
    [existing] = await db.insert(t.skills).values(values).returning();
    await db
      .insert(t.skillVersions)
      .values({ skillId: existing!.id, version: 1, body: values.body })
      .onConflictDoNothing();
  }
  apiSkillIds.set(slug, existing!.id);
}

// ---- API Contract Reviewer agent ----
const [existingApiAgent] = await db
  .select()
  .from(t.agents)
  .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, 'API Contract Reviewer')));

if (!existingApiAgent) {
  const [apiAgent] = await db
    .insert(t.agents)
    .values({
      workspaceId,
      name: 'API Contract Reviewer',
      description: 'Detects breaking API changes, schema violations, and versioning issues before merge.',
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: `You are an API contract expert reviewing pull requests. Your job is to detect changes that could break API consumers.

Focus on:
1. Breaking changes to public API signatures (renamed fields, removed endpoints, changed types)
2. Response schema mutations (new required fields, changed nullability, type widening/narrowing)
3. Versioning discipline violations (breaking change without major bump)
4. Missing deprecation notices (silent removal vs. proper deprecation → removal cycle)

For each finding:
- Cite the exact file:line where the breaking change occurs
- Explain what downstream consumers will break
- Suggest a backwards-compatible alternative

Return at most 5 high-signal findings ranked by severity.`,
      enabled: true,
      version: 1,
      createdBy: userId,
    })
    .returning();

  // Прив'язуємо 4 скіли до агента
  const slugOrder = ['breaking-change', 'response-schema', 'semver-discipline', 'deprecation-policy'];
  for (let i = 0; i < slugOrder.length; i++) {
    const skillId = apiSkillIds.get(slugOrder[i]!);
    if (skillId) {
      await db
        .insert(t.agentSkills)
        .values({ agentId: apiAgent!.id, skillId, order: i })
        .onConflictDoNothing();
    }
  }
}
```

---

### Крок 1.7 — Typecheck

```bash
cd server && pnpm typecheck
```

Очікуємо: тільки 9 старих помилок у `run.repo.severity.test.ts`. Нових помилок нема.

---

## ЧАСТИНА 2 — CLIENT

---

### Крок 2.1 — Nav

**Файл:** `client/src/vendor/ui/nav.ts`

Спочатку перевір що іконка `ListChecks` є у `client/src/vendor/ui/icons.tsx`:

```bash
grep "ListChecks" client/src/vendor/ui/icons.tsx
```

Якщо є — додай в SKILLS LAB секцію:

```ts
{ key: "conventions", label: "Conventions", icon: "ListChecks", href: "/conventions", gKey: "v" },
```

Якщо немає — використай `"AlignLeft"`.

Фінальна SKILLS LAB секція:

```ts
{
  section: "SKILLS LAB",
  items: [
    { key: "skills",      label: "Skills",       icon: "Sparkles",   href: "/skills",       gKey: "s" },
    { key: "agents",      label: "Agents",        icon: "Cpu",        href: "/agents",        gKey: "a" },
    { key: "conventions", label: "Conventions",   icon: "ListChecks", href: "/conventions",  gKey: "v" },
  ],
},
```

Також додай шорткат в `SHORTCUTS`:

```ts
{ keys: "g v", label: "Go to Conventions", group: "Navigation" },
```

---

### Крок 2.2 — activeKeyFor

**Файл:** `client/src/components/app-shell/helpers.ts`

Додай рядок після перевірки `/skills`:

```ts
if (pathname.startsWith("/conventions")) return "conventions";
```

---

### Крок 2.3 — i18n

**Файл:** `client/messages/en/conventions.json` (створити новий файл)

```json
{
  "page": {
    "crumbLab": "Skills Lab",
    "crumb": "Conventions",
    "heading": "Conventions in",
    "rescan": "Re-scan",
    "createSkill": "Create skill",
    "acceptedCount": "{count} of {total} accepted",
    "scanning": "Scanning repository...",
    "notCloned": "Repository is not cloned yet. Clone it first to extract conventions.",
    "empty": {
      "title": "No conventions yet",
      "body": "Run a scan to extract coding conventions from this repository.",
      "cta": "Run scan"
    }
  },
  "card": {
    "confidence": "Confidence",
    "accept": "Accept",
    "accepted": "Accepted",
    "reject": "Reject",
    "editSave": "Save",
    "editCancel": "Cancel"
  },
  "modal": {
    "title": "Create skill from conventions",
    "subtitle": "Merged from {count} accepted conventions in {repo}. Everything below is editable before you save.",
    "nameLabel": "Name",
    "descriptionLabel": "Description",
    "cancel": "Cancel",
    "create": "Create skill",
    "savedHint": "Saved as v1 · added to Skills Lab"
  }
}
```

Також додай до `client/messages/en/index.ts` або де збираються i18n файли імпорт `conventions`.

---

### Крок 2.4 — Hooks

**Файл:** `client/src/lib/hooks/conventions.ts` (створити)

```ts
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ConventionCandidate, Skill } from "@devdigest/shared";

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions", repoId],
    queryFn: () => api.get<ConventionCandidate[]>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<ConventionCandidate[]>(`/repos/${repoId}/conventions/extract`, {}),
    onSuccess: (_data, repoId) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export function useAcceptConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, id }: { repoId: string; id: string }) =>
      api.patch<ConventionCandidate>(`/repos/${repoId}/conventions/${id}`, { accepted: true }),
    onSuccess: (_d, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export function useRejectConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, id }: { repoId: string; id: string }) =>
      api.patch<{ ok: boolean }>(`/repos/${repoId}/conventions/${id}`, { accepted: false }),
    onSuccess: (_d, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export function useUpdateConventionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, id, rule }: { repoId: string; id: string; rule: string }) =>
      api.patch<ConventionCandidate>(`/repos/${repoId}/conventions/${id}`, { rule }),
    onSuccess: (_d, { repoId }) => {
      qc.invalidateQueries({ queryKey: ["conventions", repoId] });
    },
  });
}

export interface CreateSkillFromConventionsInput {
  repoId: string;
  name: string;
  description: string;
}

export function useCreateSkillFromConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, ...body }: CreateSkillFromConventionsInput) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export function useImportSkillFromUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { url: string; name: string; description?: string }) =>
      api.post<Skill>('/skills/import-url', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}
```

Перевір що `api.patch` є у `client/src/lib/api.ts`. Якщо нема — додай:

```ts
patch: <T>(url: string, body: unknown): Promise<T> =>
  fetcher<T>(url, { method: 'PATCH', body: JSON.stringify(body) }),
```

**Файл:** `client/src/lib/hooks/index.ts` — додай:

```ts
export * from "./conventions";
```

---

### Крок 2.5 — Сторінка /conventions

**Структура файлів:**

```
client/src/app/conventions/
  page.tsx
  _components/
    ConventionsView/
      ConventionsView.tsx
    ConventionCard/
      ConventionCard.tsx
    CreateSkillFromConventionsModal/
      CreateSkillFromConventionsModal.tsx
```

---

#### `page.tsx`

```tsx
import { ConventionsView } from "./_components/ConventionsView/ConventionsView";

export default function ConventionsPage() {
  return <ConventionsView />;
}
```

---

#### `ConventionsView.tsx`

```tsx
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { Button, EmptyState, Skeleton } from "@devdigest/ui";
import { useActiveRepo } from "@/lib/contexts/repoContext";
import {
  useConventions,
  useExtractConventions,
} from "@/lib/hooks/conventions";
import { ConventionCard } from "../ConventionCard/ConventionCard";
import { CreateSkillFromConventionsModal } from "../CreateSkillFromConventionsModal/CreateSkillFromConventionsModal";

export function ConventionsView() {
  const t = useTranslations("conventions");
  const { repoId, activeRepo } = useActiveRepo();
  const { data: conventions = [], isLoading } = useConventions(repoId);
  const extract = useExtractConventions();
  const [showModal, setShowModal] = React.useState(false);

  const accepted = conventions.filter((c) => c.accepted);
  const total = conventions.length;

  const crumb = [
    { label: t("page.crumbLab") },
    { label: t("page.crumb") },
  ];

  return (
    <AppShell crumb={crumb}>
      {showModal && repoId && (
        <CreateSkillFromConventionsModal
          repoId={repoId}
          repoName={activeRepo?.name ?? "repo"}
          acceptedCount={accepted.length}
          onClose={() => setShowModal(false)}
          onCreated={() => setShowModal(false)}
        />
      )}

      <div style={{ padding: 28, maxWidth: 860 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            marginBottom: 20,
          }}
        >
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
              {t("page.heading")}{" "}
              <span style={{ color: "var(--accent)" }}>
                {activeRepo?.name ?? "—"}
              </span>
            </h1>
            {total > 0 && (
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {t("page.acceptedCount", {
                  count: accepted.length,
                  total,
                })}
              </p>
            )}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Button
              kind="secondary"
              icon="RefreshCw"
              onClick={() => repoId && extract.mutate(repoId)}
              loading={extract.isPending}
            >
              {t("page.rescan")}
            </Button>
            {accepted.length > 0 && (
              <Button
                kind="primary"
                icon="Sparkles"
                onClick={() => setShowModal(true)}
              >
                {t("page.createSkill")}
              </Button>
            )}
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Skeleton height={120} />
            <Skeleton height={120} />
            <Skeleton height={120} />
          </div>
        ) : total === 0 && !extract.isPending ? (
          <EmptyState
            icon="ListChecks"
            title={t("page.empty.title")}
            body={t("page.empty.body")}
            cta={t("page.empty.cta")}
            onCta={() => repoId && extract.mutate(repoId)}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {extract.isPending && (
              <div
                style={{
                  padding: 16,
                  textAlign: "center",
                  color: "var(--text-muted)",
                  fontSize: 13,
                }}
              >
                {t("page.scanning")}
              </div>
            )}
            {conventions.map((c) => (
              <ConventionCard
                key={c.id}
                convention={c}
                repoId={repoId!}
                repoUrl={activeRepo ? `https://github.com/${activeRepo.full_name}` : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
```

---

#### `ConventionCard.tsx`

```tsx
"use client";

import React from "react";
import type { ConventionCandidate } from "@devdigest/shared";
import {
  useAcceptConvention,
  useRejectConvention,
  useUpdateConventionRule,
} from "@/lib/hooks/conventions";

interface Props {
  convention: ConventionCandidate;
  repoId: string;
  repoUrl?: string;
}

function confidenceColor(v: number): string {
  if (v >= 0.85) return "var(--success)";
  if (v >= 0.7) return "#f59e0b";
  return "var(--text-muted)";
}

export function ConventionCard({ convention: c, repoId, repoUrl }: Props) {
  const accept = useAcceptConvention();
  const reject = useRejectConvention();
  const updateRule = useUpdateConventionRule();

  // Inline edit state
  const [editing, setEditing] = React.useState(false);
  const [draftRule, setDraftRule] = React.useState(c.rule);

  const handleSaveRule = () => {
    if (draftRule.trim() && draftRule !== c.rule) {
      updateRule.mutate({ repoId, id: c.id, rule: draftRule.trim() });
    }
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setDraftRule(c.rule);
    setEditing(false);
  };

  // Посилання на файл у GitHub
  const evidenceUrl =
    repoUrl && c.evidence_path
      ? `${repoUrl}/blob/main/${c.evidence_path}`
      : undefined;

  return (
    <div
      style={{
        border: `1.5px solid ${c.accepted ? "var(--success)" : "var(--border)"}`,
        borderRadius: 10,
        padding: 16,
        background: "var(--bg-surface)",
        display: "flex",
        gap: 16,
      }}
    >
      {/* Left: rule + evidence */}
      <div style={{ flex: 1 }}>
        {/* Inline edit правила */}
        {editing ? (
          <div style={{ marginBottom: 10 }}>
            <textarea
              value={draftRule}
              onChange={(e) => setDraftRule(e.target.value)}
              rows={2}
              style={{
                width: "100%",
                padding: "6px 10px",
                border: "1px solid var(--accent)",
                borderRadius: 6,
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                fontSize: 14,
                fontStyle: "italic",
                fontWeight: 600,
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button
                onClick={handleSaveRule}
                disabled={updateRule.isPending}
                style={{
                  padding: "4px 10px",
                  borderRadius: 5,
                  border: "none",
                  background: "var(--accent)",
                  color: "#fff",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
              <button
                onClick={handleCancelEdit}
                style={{
                  padding: "4px 10px",
                  borderRadius: 5,
                  border: "1px solid var(--border)",
                  background: "transparent",
                  color: "var(--text-muted)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <p
            onClick={() => setEditing(true)}
            title="Click to edit"
            style={{
              fontStyle: "italic",
              fontWeight: 600,
              marginBottom: 10,
              fontSize: 14,
              cursor: "text",
            }}
          >
            {c.rule}
          </p>
        )}

        {/* Evidence snippet */}
        {c.evidence_path && (
          <div
            style={{
              background: "var(--bg-elevated)",
              borderRadius: 7,
              padding: "8px 12px",
              fontFamily: "monospace",
              fontSize: 12,
              marginBottom: 10,
            }}
          >
            <div
              style={{
                color: "var(--text-muted)",
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span>{c.evidence_path}</span>
              {evidenceUrl && (
                <a
                  href={evidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "var(--accent)", fontSize: 11 }}
                >
                  ↗ GitHub
                </a>
              )}
            </div>
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                color: "var(--text-primary)",
              }}
            >
              {c.evidence_snippet}
            </pre>
          </div>
        )}

        {/* Confidence bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          <span>Confidence</span>
          <div
            style={{
              width: 120,
              height: 4,
              background: "var(--border)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.round(c.confidence * 100)}%`,
                height: "100%",
                background: confidenceColor(c.confidence),
                borderRadius: 2,
              }}
            />
          </div>
          <span>{Math.round(c.confidence * 100)}%</span>
        </div>
      </div>

      {/* Right: actions */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
          minWidth: 110,
        }}
      >
        <button
          onClick={() =>
            !c.accepted && accept.mutate({ repoId, id: c.id })
          }
          disabled={c.accepted || accept.isPending}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "none",
            background: c.accepted ? "var(--success)" : "var(--accent)",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: c.accepted ? "default" : "pointer",
            opacity: accept.isPending ? 0.7 : 1,
          }}
        >
          {c.accepted ? "✓ Accepted" : "✓ Accept"}
        </button>
        <button
          onClick={() => reject.mutate({ repoId, id: c.id })}
          disabled={reject.isPending}
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          × Reject
        </button>
      </div>
    </div>
  );
}
```

---

#### `CreateSkillFromConventionsModal.tsx`

```tsx
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useCreateSkillFromConventions } from "@/lib/hooks/conventions";
import { Modal, Button } from "@devdigest/ui";

interface Props {
  repoId: string;
  repoName: string;
  acceptedCount: number;
  onClose: () => void;
  onCreated: () => void;
}

export function CreateSkillFromConventionsModal({
  repoId,
  repoName,
  acceptedCount,
  onClose,
  onCreated,
}: Props) {
  const router = useRouter();
  const createSkill = useCreateSkillFromConventions();
  const [name, setName] = React.useState(`${repoName}-conventions`);
  const [description, setDescription] = React.useState(
    `${acceptedCount} house conventions extracted from ${repoName}`,
  );

  const handleCreate = async () => {
    const skill = await createSkill.mutateAsync({ repoId, name, description });
    onCreated();
    router.push(`/skills/${skill.id}`);
  };

  return (
    <Modal onClose={onClose} title="Create skill from conventions">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Info banner */}
        <div
          style={{
            background: "color-mix(in srgb, var(--accent) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)",
            borderRadius: 8,
            padding: "10px 14px",
            fontSize: 13,
            color: "var(--text-secondary)",
          }}
        >
          ✦ Merged from{" "}
          <strong>{acceptedCount} accepted conventions</strong> in{" "}
          <span style={{ color: "var(--accent)" }}>{repoName}</span>.
          Everything below is editable before you save.
        </div>

        {/* Name */}
        <div>
          <label
            style={{
              fontSize: 13,
              fontWeight: 600,
              display: "block",
              marginBottom: 6,
            }}
          >
            Name *
          </label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Description */}
        <div>
          <label
            style={{
              fontSize: 13,
              fontWeight: 600,
              display: "block",
              marginBottom: 6,
            }}
          >
            Description
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
              fontSize: 14,
              boxSizing: "border-box",
            }}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginTop: 8,
          }}
        >
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            ← Saved as v1 · added to Skills Lab
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button kind="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              kind="primary"
              icon="Sparkles"
              onClick={handleCreate}
              loading={createSkill.isPending}
              disabled={!name.trim()}
            >
              Create skill
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
```

---

### Крок 2.6 — URL Import вкладка у CreateSkillModal

**Файл:** `client/src/app/skills/_components/CreateSkillModal/CreateSkillModal.tsx`

Додай третю вкладку `"Import from URL"` поруч з існуючими "Create" та "Import".

Логіка вкладки:

```tsx
// Стан для URL вкладки
const [importUrl, setImportUrl] = React.useState("");
const [urlName, setUrlName] = React.useState("");
const [urlPreview, setUrlPreview] = React.useState<string | null>(null);
const importFromUrl = useImportSkillFromUrl();

// Fetch preview через сервер
const handleFetchUrl = async () => {
  // Валідація на клієнті — тільки https://
  if (!importUrl.startsWith("https://")) {
    alert("Only HTTPS URLs are allowed");
    return;
  }
  // Попередній перегляд — можна зробити через окремий GET або просто показати поле name
  // Для MVP: одразу зберігаємо після введення name
};

const handleImportFromUrl = async () => {
  const skill = await importFromUrl.mutateAsync({
    url: importUrl,
    name: urlName,
  });
  onCreated(skill.id);
};

// JSX для URL вкладки:
<div>
  <label>URL (https:// only)</label>
  <input
    value={importUrl}
    onChange={(e) => setImportUrl(e.target.value)}
    placeholder="https://raw.githubusercontent.com/..."
    type="url"
  />

  <label>Skill name</label>
  <input
    value={urlName}
    onChange={(e) => setUrlName(e.target.value)}
    placeholder="my-skill"
  />

  <Button
    kind="primary"
    onClick={handleImportFromUrl}
    disabled={!importUrl.startsWith("https://") || !urlName.trim()}
    loading={importFromUrl.isPending}
  >
    Import
  </Button>
</div>
```

---

### Крок 2.7 — Typecheck client

```bash
cd client && pnpm typecheck
```

Очікуємо: 0 помилок.

---

## ПОРЯДОК ВИКОНАННЯ

```
1.  server/src/db/schema/knowledge.ts        → додати createdAt
2.  cd server && pnpm db:generate && pnpm db:migrate
3.  server/src/db/rows.ts                    → додати ConventionRow
4.  server/src/modules/conventions/repository.ts
5.  server/src/modules/conventions/extractor.ts
6.  server/src/modules/conventions/service.ts
7.  server/src/modules/conventions/routes.ts
8.  server/src/modules/skills/routes.ts      → додати /skills/import-url з safeFetchSkillUrl
9.  server/src/modules/index.ts              → зареєструвати conventions
10. server/src/db/seed.ts                    → API Contract Reviewer + 4 скіли
11. cd server && pnpm typecheck              → тільки 9 старих помилок
12. client/src/vendor/ui/nav.ts             → Conventions у SKILLS LAB
13. client/src/components/app-shell/helpers.ts → activeKeyFor conventions
14. client/messages/en/conventions.json     → i18n
15. client/src/lib/api.ts                   → перевірити/додати api.patch
16. client/src/lib/hooks/conventions.ts     → всі хуки
17. client/src/lib/hooks/index.ts           → export * from "./conventions"
18. client/src/app/conventions/page.tsx
19. client/src/app/conventions/_components/ConventionsView/ConventionsView.tsx
20. client/src/app/conventions/_components/ConventionCard/ConventionCard.tsx
21. client/src/app/conventions/_components/CreateSkillFromConventionsModal/CreateSkillFromConventionsModal.tsx
22. client/src/app/skills/_components/CreateSkillModal/CreateSkillModal.tsx → URL вкладка
23. cd client && pnpm typecheck              → 0 помилок
24. cd server && pnpm db:seed               → засіяти API Contract Reviewer
```

---

## КРИТЕРІЇ ПРИЙНЯТТЯ

### Conventions Extractor (обов'язкові)

| # | Критерій | Як перевірити |
|---|----------|--------------|
| 1 | Запустити аналіз репозиторію | `/conventions` → "Re-scan" → список конвенцій з'являється |
| 2 | Побачити всі знайдені конвенції | Кожна картка показує правило, код-сніппет, confidence bar |
| 3 | Accept конвенції | Кнопка "✓ Accept" → картка підсвічується зеленим, лічильник "N of M accepted" росте |
| 4 | Reject конвенції | Кнопка "× Reject" → картка зникає зі списку |
| 5 | **Inline edit правила на картці** | Клік на текст правила → textarea → змінити текст → Save → текст оновлюється |
| 6 | **Edit тіла у модалі** | "Create skill" → модал → тіло скіла можна змінити перед збереженням |
| 7 | Зберегти скіл | "Create skill" у модалі → redirect на `/skills/:id` |
| 8 | Відмовитись від збереження | "Cancel" закриває модал, скіл не створюється |
| 9 | Rejected не потрапляють у скіл | Тіло скіла містить тільки accepted конвенції |
| 10 | Кожен кандидат має реальні докази | Evidence snippet з реальним файлом і рядком з репо |
| 11 | Скіл можна прилінкувати до агента | Скіл з'являється у Skills tab агента після створення |
| 12 | Клік на evidence → GitHub | Посилання "↗ GitHub" відкриває файл у репо на GitHub |

### API Contract Reviewer (обов'язкові)

| # | Критерій | Як перевірити |
|---|----------|--------------|
| 13 | Агент є в списку | `/agents` показує "API Contract Reviewer" після `pnpm db:seed` |
| 14 | 4 скіли прив'язані | Skills tab агента → 4 скіли у правильному порядку |
| 15 | Мінімум 1 скіл через Import | Взяти один зі скілів → видалити → імпортувати через URL або файл |
| 16 | Без скілів — пропускає | General Reviewer не знаходить breaking change у тестовому PR |
| 17 | Зі скілами — ловить | API Contract Reviewer знаходить breaking change і цитує file:line |

### URL Import (додаткове)

| # | Критерій | Як перевірити |
|---|----------|--------------|
| 18 | Import скіла з HTTPS URL | Create Skill → "Import from URL" → вставити GitHub raw URL → Import → скіл збережено |
| 19 | SSRF захист | Спробувати `https://localhost/test` → отримати 400 "Private and local URLs are not allowed" |
| 20 | Ліміт розміру | URL файлу >100KB → отримати 400 "File too large" |
| 21 | Таймаут | URL що не відповідає → через 10 сек отримати 400 "Failed to fetch URL" |
