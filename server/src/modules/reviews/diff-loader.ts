/**
 * TASK-007 (R-B) — moved to `modules/_shared/diff/diff-loader.ts` so `pulls`
 * can share the same diff-first loader without reaching across module
 * boundaries into `reviews`. This file is now a thin re-export; no call site
 * in `reviews` (`service.ts`, `run-executor.ts`) needed to change.
 */
export { loadDiff, diffFromPrFiles } from '../_shared/diff/diff-loader.js';
