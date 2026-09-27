/** Single source of Smart Diff classification constants: the per-role path
 *  patterns, the order roles are CHECKED in, the default role, and the order
 *  groups are DISPLAYED in. Pure constants — type-only import, no side-effects.
 *  `classifier.ts` contains no role names or ordering of its own. */

import type { SmartDiffRole } from "@devdigest/shared";

/** Files that are generated, vendored, or mechanically maintained.
 *  Reviewers usually skip these entirely. */
export const BOILERPLATE_PATTERNS: RegExp[] = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /\.lock$/,
  /\.min\.(js|css)$/,
  /\.generated\./,
  /(__generated__|_generated_)/i,
  /\.d\.ts$/,
  /\/dist\//,
  /^dist\//,
  /(^|\/)build\//,
  /(^|\/)__snapshots__\//,
  /\.snap$/,
  /\/migrations?\//,
  /^migrations?\//,
  /\.svg$/,
];

/** Test files and test directories, at any depth. */
export const TESTS_PATTERNS: RegExp[] = [
  /\.(test|spec)\.[jt]sx?$/,
  /(^|\/)(test|tests|__tests__|e2e)\//,
];

/** Files that wire the app together: entry-points, routers, configs, CI/dev
 *  tooling config. Important to scan but not the primary logic. */
export const WIRING_PATTERNS: RegExp[] = [
  /(^|\/)(index|main|bootstrap)\.[jt]sx?$/,
  /(^|\/)app\.[jt]sx?$/,
  /(^|\/)server\.[jt]sx?$/,
  /(^|\/)routes?\.[jt]sx?$/,
  /(^|\/)config\.[jt]sx?$/,
  /(^|\/)setup\.[jt]sx?$/,
  /(^|\/)entry\.[jt]sx?$/,
  /\.config\.(js|ts|mjs|cjs)$/,
  /(^|\/)\.claude\//,
  /(^|\/)\.env[^/]*$/,
  /(^|\/)docker-compose[^/]*\.ya?ml$/,
  /(^|\/)\.eslintrc[^/]*$/,
  /(^|\/)tsconfig[^/]*\.json$/,
];

/** Documentation and licensing files. */
export const DOCS_PATTERNS: RegExp[] = [
  /\.md$/i,
  /(^|\/)docs\//,
  /(^|\/)README[^/]*$/i,
  /(^|\/)CHANGELOG[^/]*$/i,
  /(^|\/)LICENSE[^/]*$/i,
];

/** Role → its path patterns. `core` has none: it is the fallback. */
export const ROLE_PATTERNS: Record<Exclude<SmartDiffRole, "core">, RegExp[]> = {
  boilerplate: BOILERPLATE_PATTERNS,
  tests: TESTS_PATTERNS,
  wiring: WIRING_PATTERNS,
  docs: DOCS_PATTERNS,
};

/** Order roles are CHECKED in: a path matching several roles' patterns gets
 *  the first one in this list (e.g. `__tests__/__snapshots__/x.snap` →
 *  boilerplate, `e2e/README.md` → tests). */
export const ROLE_CHECK_ORDER: readonly Exclude<SmartDiffRole, "core">[] = [
  "boilerplate",
  "tests",
  "wiring",
  "docs",
];

/** Role for a path that matches no pattern. */
export const DEFAULT_ROLE: SmartDiffRole = "core";

/** Order groups are DISPLAYED in (differs from the check order above). */
export const ROLE_DISPLAY_ORDER: readonly SmartDiffRole[] = [
  "core",
  "tests",
  "wiring",
  "docs",
  "boilerplate",
];

/** Lines-changed threshold above which `split_suggestion.too_big` is set. */
export const TOO_BIG_THRESHOLD = 400;
