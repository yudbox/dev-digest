/** Regex patterns used to classify PR files into roles.
 *  Pure constants — no imports, no side-effects. */

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
  /\.snap$/,
  /\/migrations?\//,
  /^migrations?\//,
  /CHANGELOG\.md$/i,
  /\.svg$/,
];

/** Files that wire the app together: entry-points, routers, configs.
 *  Important to scan but not the primary logic. */
export const WIRING_PATTERNS: RegExp[] = [
  /(^|\/)(index|main|bootstrap)\.[jt]sx?$/,
  /(^|\/)app\.[jt]sx?$/,
  /(^|\/)server\.[jt]sx?$/,
  /(^|\/)routes?\.[jt]sx?$/,
  /(^|\/)config\.[jt]sx?$/,
  /(^|\/)setup\.[jt]sx?$/,
  /(^|\/)entry\.[jt]sx?$/,
  /\.config\.(js|ts|mjs|cjs)$/,
];

/** Lines-changed threshold above which `split_suggestion.too_big` is set. */
export const TOO_BIG_THRESHOLD = 400;
