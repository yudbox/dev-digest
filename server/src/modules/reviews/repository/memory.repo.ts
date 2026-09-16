import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../../db/client.js";
import * as t from "../../../db/schema.js";

export async function insertMemory(
  db: Db,
  values: {
    workspaceId: string;
    repoId: string | null;
    content: string;
    embedding: number[];
    sources: Record<string, string | null | undefined>;
  },
): Promise<void> {
  await db.insert(t.memory).values({
    workspaceId: values.workspaceId,
    repoId: values.repoId,
    scope: "repo",
    kind: "learning",
    content: values.content,
    embedding: values.embedding,
    confidence: 1.0,
    sources: values.sources as object,
  });
}

export async function searchMemory(
  db: Db,
  values: {
    workspaceId: string;
    repoId: string | null;
    embedding: number[];
    limit: number;
  },
): Promise<{ id: string; content: string }[]> {
  const embStr = `[${values.embedding.join(",")}]`;
  return db
    .select({ id: t.memory.id, content: t.memory.content })
    .from(t.memory)
    .where(
      and(
        eq(t.memory.workspaceId, values.workspaceId),
        values.repoId !== null
          ? sql`(${t.memory.repoId} = ${values.repoId}::uuid OR ${t.memory.scope} = 'global')`
          : sql`${t.memory.scope} = 'global'`,
      ),
    )
    .orderBy(sql`${t.memory.embedding} <=> ${sql.raw(`'${embStr}'::vector`)}`)
    .limit(values.limit);
}

export async function bumpLastUsedAt(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(t.memory)
    .set({ lastUsedAt: new Date() })
    .where(inArray(t.memory.id, ids));
}
