import { describe, it, expect } from "vitest";
import { SmartDiffRole, SmartDiffFile } from "@devdigest/shared";
import { classifyFile, buildSmartDiff } from "./classifier.js";
import {
  ROLE_CHECK_ORDER,
  ROLE_DISPLAY_ORDER,
  DEFAULT_ROLE,
  ROLE_PATTERNS,
} from "./classifier-patterns.js";

// ── classifyFile — path → role table ────────────────────────────────────────

describe("classifyFile", () => {
  const cases: Array<[string, string]> = [
    // core (default — nothing else matches)
    ["src/middleware/rateLimit.ts", "core"],
    ["src/api/public/webhooks.ts", "core"],

    // boilerplate
    ["package-lock.json", "boilerplate"],
    ["yarn.lock", "boilerplate"],
    ["pnpm-lock.yaml", "boilerplate"],
    ["src/api/__generated__/types.ts", "boilerplate"],
    ["src/schema.generated.ts", "boilerplate"],
    ["src/types.d.ts", "boilerplate"],
    ["dist/index.js", "boilerplate"],
    ["build/index.js", "boilerplate"],
    ["src/build/compile.ts", "boilerplate"],
    ["__snapshots__/a.snap", "boilerplate"],
    ["src/foo.min.js", "boilerplate"],
    ["src/foo.min.css", "boilerplate"],
    ["db/migrations/0001_init.sql", "boilerplate"],
    ["assets/logo.svg", "boilerplate"],

    // tests
    ["src/foo.test.ts", "tests"],
    ["src/foo.test.tsx", "tests"],
    ["src/foo.spec.ts", "tests"],
    ["src/foo.it.test.ts", "tests"],
    ["test/rateLimit.test.ts", "tests"],
    ["tests/rateLimit.ts", "tests"],
    ["__tests__/rateLimit.ts", "tests"],
    ["e2e/playwright.config.ts", "tests"],
    ["e2e/README.md", "tests"],

    // wiring
    ["src/index.ts", "wiring"],
    ["index.ts", "wiring"],
    ["src/api/index.js", "wiring"],
    ["src/routes.ts", "wiring"],
    ["src/api/routes.ts", "wiring"],
    ["src/config.ts", "wiring"],
    ["jest.config.ts", "wiring"],
    ["src/server.ts", "wiring"],
    [".claude/README.md", "wiring"],
    [".claude/skills/security/SKILL.md", "wiring"],
    [".env.example", "wiring"],
    [".env.local", "wiring"],
    ["docker-compose.yml", "wiring"],
    ["docker-compose.override.yaml", "wiring"],
    [".eslintrc.json", "wiring"],
    ["tsconfig.json", "wiring"],
    ["tsconfig.build.json", "wiring"],

    // docs
    ["CHANGELOG.md", "docs"],
    ["README.md", "docs"],
    ["docs/architecture.md", "docs"],
    ["LICENSE", "docs"],
    ["LICENSE.txt", "docs"],

    // the three disputed HW cases (AC-7) — resolved by the check order
    ["__tests__/__snapshots__/x.snap", "boilerplate"],
    [".claude/skills/security/SKILL.md", "wiring"],
    ["e2e/README.md", "tests"],
  ];

  it.each(cases)("classifies %s as %s", (path, role) => {
    expect(classifyFile(path)).toBe(role);
  });

  it("classifies the three disputed HW cases (AC-7)", () => {
    expect(classifyFile("__tests__/__snapshots__/x.snap")).toBe("boilerplate");
    expect(classifyFile(".claude/skills/security/SKILL.md")).toBe("wiring");
    expect(classifyFile("e2e/README.md")).toBe("tests");
  });

  it("is pure and deterministic — same path always yields the same role, no I/O", () => {
    const path = "src/foo.test.ts";
    const results = Array.from({ length: 5 }, () => classifyFile(path));
    expect(new Set(results).size).toBe(1);
  });
});

// ── buildSmartDiff ───────────────────────────────────────────────────────────

describe("buildSmartDiff", () => {
  it("groups files by role in the display order core → tests → wiring → docs → boilerplate", () => {
    const result = buildSmartDiff([
      { path: "package-lock.json", additions: 100, deletions: 10 },
      { path: "README.md", additions: 5, deletions: 2 },
      { path: "src/index.ts", additions: 5, deletions: 2 },
      { path: "src/foo.test.ts", additions: 3, deletions: 1 },
      { path: "src/middleware/rateLimit.ts", additions: 30, deletions: 0 },
    ]);
    expect(result.groups.map((g) => g.role)).toEqual([
      "core",
      "tests",
      "wiring",
      "docs",
      "boilerplate",
    ]);
  });

  it("always returns all five groups in display order, empty ones with no files", () => {
    const result = buildSmartDiff([
      { path: "src/foo.ts", additions: 1, deletions: 0 },
    ]);
    expect(result.groups.map((g) => g.role)).toEqual([
      "core",
      "tests",
      "wiring",
      "docs",
      "boilerplate",
    ]);
    expect(result.groups.map((g) => g.files.length)).toEqual([1, 0, 0, 0, 0]);
  });

  it("returns five empty groups for a PR with no files", () => {
    const result = buildSmartDiff([]);
    expect(result.groups).toHaveLength(5);
    expect(result.groups.every((g) => g.files.length === 0)).toBe(true);
  });

  it("sets too_big=true when total lines > 400", () => {
    const files = Array.from({ length: 5 }, (_, i) => ({
      path: `src/file${i}.ts`,
      additions: 50,
      deletions: 50,
    }));
    const result = buildSmartDiff(files);
    expect(result.split_suggestion.too_big).toBe(true);
    expect(result.split_suggestion.total_lines).toBe(500);
  });

  it("sets too_big=false when total lines ≤ 400", () => {
    const result = buildSmartDiff([
      { path: "src/foo.ts", additions: 100, deletions: 100 },
    ]);
    expect(result.split_suggestion.too_big).toBe(false);
  });

  it("initialises line_findings as null (no review has run yet)", () => {
    const result = buildSmartDiff([
      { path: "src/foo.ts", additions: 1, deletions: 0 },
    ]);
    expect(result.groups[0]!.files[0]!.line_findings).toBeNull();
  });
});

// ── contract shape ───────────────────────────────────────────────────────────

describe("SmartDiffRole contract", () => {
  it("accepts the 5 defined values", () => {
    for (const role of ["core", "tests", "wiring", "docs", "boilerplate"]) {
      expect(SmartDiffRole.safeParse(role).success).toBe(true);
    }
  });

  it("rejects any other value", () => {
    expect(SmartDiffRole.safeParse("other").success).toBe(false);
  });
});

describe("SmartDiffFile contract", () => {
  it("parse leaves no finding_lines/severity_counts keys", () => {
    const parsed = SmartDiffFile.parse({
      path: "src/foo.ts",
      pseudocode_summary: null,
      additions: 1,
      deletions: 0,
      line_findings: null,
      finding_lines: [1, 2, 3],
      severity_counts: { critical: 1, warning: 0, suggestion: 0 },
    });
    expect(parsed).not.toHaveProperty("finding_lines");
    expect(parsed).not.toHaveProperty("severity_counts");
  });
});

describe("classifier constants (single source of roles, patterns and orders)", () => {
  it("defines the check order, default role and display order", () => {
    expect(ROLE_CHECK_ORDER).toEqual(["boilerplate", "tests", "wiring", "docs"]);
    expect(DEFAULT_ROLE).toBe("core");
    expect(ROLE_DISPLAY_ORDER).toEqual(["core", "tests", "wiring", "docs", "boilerplate"]);
  });

  it("has patterns for every checked role, and every role appears in the display order", () => {
    for (const role of ROLE_CHECK_ORDER) expect(ROLE_PATTERNS[role].length).toBeGreaterThan(0);
    expect([...ROLE_DISPLAY_ORDER].sort()).toEqual([...ROLE_CHECK_ORDER, DEFAULT_ROLE].sort());
  });
});
