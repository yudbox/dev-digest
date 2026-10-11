import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "../../src/db/client.js";
import { schema } from "../../src/db/schema.js";

/**
 * In-memory Postgres for integration tests: PGlite (real Postgres compiled to
 * WebAssembly) living inside the test process. Nothing touches Docker, the
 * network or any developer/production database, and the whole database vanishes
 * when `stop()` is called.
 *
 * Differences from the real thing, all test-only:
 *  - pgvector is not available in PGlite, so `vector(N)` columns are created as
 *    `text`. Tests using this helper must not rely on embeddings/similarity
 *    (cover those with unit tests and a stub embedder instead).
 *  - PGlite's `execute()` returns `{ rows }`; the production driver returns the
 *    row array itself. The wrapper below unwraps it so repositories that use raw
 *    `db.execute(sql...)` run unchanged.
 */

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../src/db/migrations");

export interface MemoryPgFixture {
  handle: { db: Db };
  stop: () => Promise<void>;
}

function migrationStatements(): string[] {
  const journalPath = join(MIGRATIONS_DIR, "meta/_journal.json");
  if (!existsSync(journalPath)) {
    throw new Error(`No migrations at ${MIGRATIONS_DIR}. Run \`pnpm db:generate\` first.`);
  }
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: { tag: string }[] };
  return journal.entries.flatMap((entry) =>
    readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), "utf8")
      .replaceAll(/vector\(\d+\)/g, "text")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

export async function startMemoryPg(): Promise<MemoryPgFixture> {
  const client = new PGlite(); // no dataDir → in memory
  for (const statement of migrationStatements()) {
    await client.exec(statement);
  }

  const pgliteDb = drizzle(client, { schema });
  const db = new Proxy(pgliteDb, {
    get(target, prop, receiver) {
      if (prop === "execute") {
        return async (...args: unknown[]) => {
          const result = await (target.execute as (...a: unknown[]) => Promise<{ rows: unknown[] }>)(...args);
          return result.rows;
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as Db;

  return {
    handle: { db },
    stop: async () => {
      await client.close();
    },
  };
}
