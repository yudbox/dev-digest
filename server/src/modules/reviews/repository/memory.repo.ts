import { inArray } from "drizzle-orm";
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

export async function bumpLastUsedAt(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(t.memory)
    .set({ lastUsedAt: new Date() })
    .where(inArray(t.memory.id, ids));
}
