#!/usr/bin/env bash
#
# verify-l06 — the eval-pipeline (A6/L06) green-light check.
#
#   ./scripts/verify-l06.sh
#
# Runs, in order, aborting on the first failure:
#   1. server typecheck
#   2. client typecheck
#   3. server hermetic scoring test (0 LLM calls, pure — scoring.ts)
#   4. server integration test (real Postgres — evals module end-to-end,
#      including the AC-7/AC-11 "prompt edit between two batches changes
#      recall/precision" assertion)
#
# Step 4 requires a running Postgres reachable the same way any other
# `*.it.test.ts` needs one (Testcontainers spins up its own container per
# run — see server/test/helpers/pg.ts; Docker must be available). If Docker
# is not reachable, that test file's `describe.skip` guard means the test is
# SKIPPED, not failed — this script still exits 0 in that case, matching how
# every other `.it.test.ts` in this repo behaves without Docker.
#
# Exits 0 iff all four steps succeed; any failing step aborts immediately
# with that step's own nonzero exit code (no swallowing — `set -e`).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

log "1/4 — server typecheck"
(cd server && pnpm typecheck)

log "2/4 — client typecheck"
(cd client && pnpm typecheck)

log "3/4 — server hermetic scoring test (0 LLM calls)"
(cd server && pnpm exec vitest run src/modules/evals/scoring.test.ts)

log "4/4 — server integration test (evals module, real Postgres via Testcontainers)"
(cd server && pnpm exec vitest run src/modules/evals/evals.it.test.ts)

log "verify-l06: all green ✓"
