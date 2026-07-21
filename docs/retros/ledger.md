# Workflow Retro Ledger

Trend file — one row per `/workflow-retro` run. Append only, never edit existing rows.

| Date | Workflow | Plan / Spec | Agents | Cost Est | Cache % | Parallelism | Bottleneck | Duplications | Gaps | Status |
|------|----------|-------------|--------|----------|---------|-------------|------------|--------------|------|--------|
| 2026-07-02 14:xx | skill-creation-session | workflow-retro SKILL.md, SPEC-2026-07-02-project-context.md | 2 | ~$0.35+ | — | 1.0x | Explore #2 (unused, 2.0m) | 1 | 2 | ⚠️ |
| 2026-07-02 15:02 | skill-creation-session (retro ×4) | workflow-retro SKILL.md | 2 | $1.60 | 66% | 1.0x | a1e821c2 (65%, discarded) | 1 | 2 | ⚠️ |
| 2026-07-02 15:15 | skill-creation-session (retro ×5) | workflow-retro SKILL.md | 2 | $1.60 | 66% | 1.0x | a1e821c2 (65%, discarded) | 1 | 2 | ⚠️ |
| 2026-07-02 15:20 | skill-creation-session (retro ×6) | workflow-retro SKILL.md | 2 | $1.60 | 66% | 1.0x | a1e821c2 (65%, discarded) | 1 | 2 | ⚠️ |
| 2026-07-02 17:xx | run-plan project-context | PLAN-project-context.md | 7 | $27.15 | 97% | 1.05x | a0fdc4e5 (resume, 30%) | 2 | 3 | ⚠️ |
| 2026-07-21 | export-to-ci (Worktree B) | PLAN-2026-07-19-export-to-ci.md | 1 (single-agent) | N/A | N/A | 1.0x | GitHub API 403 on createTree (~4h; Octokit deprecated Content-Type + missing "Workflows: write" PAT scope; fix: raw fetch bypass) | 0 | 3 | ✅ |
