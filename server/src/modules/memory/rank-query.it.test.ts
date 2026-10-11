import { describe, it, expect } from "vitest";
import { startMemoryPg } from "../../../test/helpers/memory-pg.js";
import { rankQuery } from "./repository.js";

/**
 * The similarity query needs pgvector, which the in-memory test database does not
 * have, so this checks the SQL SHAPE it would send (built, never executed):
 * cosine-distance ordering, the eligibility filter, NULL embeddings excluded, and
 * the vector bound as a parameter instead of spliced into the SQL text.
 */
describe("memory rankQuery SQL shape", () => {
  it("orders by cosine distance, filters scope/confidence/embedding and parameterises the vector", async () => {
    const pg = await startMemoryPg();
    try {
      const vector = [0.1, 0.2, 0.3];
      const built = rankQuery(pg.handle.db, "ws-1", "repo-1", vector, 5).toSQL();
      expect(built.sql).toMatch(/<=>/);
      expect(built.sql).toMatch(/order by .*<=>/is);
      expect(built.sql).toMatch(/"embedding" IS NOT NULL/i);
      expect(built.sql).toMatch(/"confidence" >= \$/);
      expect(built.sql).toMatch(/"scope" = \$/);
      expect(built.sql).toMatch(/limit \$/i);
      // vector and ids are bound values, not part of the SQL text
      expect(built.sql).not.toContain("0.1,0.2,0.3");
      expect(built.params).toContain("[0.1,0.2,0.3]");
      expect(built.params).toContain("ws-1");
      expect(built.params).toContain("repo-1");
      expect(built.params).toContain(5);
    } finally {
      await pg.stop();
    }
  });
});
