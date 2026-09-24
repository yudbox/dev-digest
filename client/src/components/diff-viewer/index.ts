/* diff-viewer — unified-diff viewer with optional inline GitHub comments and
   inline findings (SPEC-2026-09-23-smart-diff-hw3-upgrade). Public surface:
   the DiffViewer component + the DiffCommentApi/DiffFindingsApi contracts. */
export { DiffViewer } from "./DiffViewer";
export type { DiffCommentApi } from "./comments";
export {
  indexLineFindings,
  isActive,
  hasActive,
  mostSevereActive,
  splitByRenderedLines,
} from "./findings";
export type { DiffFindingsApi } from "./findings";
