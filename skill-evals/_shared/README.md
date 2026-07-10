# skill-evals/_shared — conventions for skill-level evals

This folder is a placeholder for a **shared eval-running mechanism** (see `TODO-skill-eval-runner.md`
at the repo root). It intentionally holds no runnable code yet — only the convention it commits to.

## Where a skill's evals actually live

**Inside the skill itself**, not here and not in a separate top-level `skill-evals/<name>/` tree:

```
.claude/skills/<name>/
├── SKILL.md
├── rules/           (if any)
└── evals/
    ├── eval.md                  — what each eval case is testing and why
    ├── expected-findings.json   — planted violations / expected outputs to grade against
    └── fixtures/                — realistic, uncommented example code with planted issues
```

This was a deliberate choice, made after comparing three candidate layouts (a plain
`onion-architecture-workspace/` scratch convention from skill-creator's Eval mode, a parallel
top-level `skill-evals/<name>/` tree, and evals living inside the skill's own folder). Evals-inside-
the-skill won because a skill is meant to be **portable** — copyable to another project wholesale —
and its evals should travel with it. A separate top-level tree would silently orphan itself the
moment the skill folder is copied elsewhere.

## What `_shared/` is for

Once the shared runner (`TODO-skill-eval-runner.md`) exists, this is where its script(s) live —
logic that every skill's `evals/eval.md` + `evals/expected-findings.json` can be run *through*, not
duplicated *into*. Until then, evals are run manually (skill-creator's Eval mode, or the `evals/`
course harness for skills that have a `*.eval.ts`/`*.cases.ts` pair under `evals/skills/<name>/`).

## Relationship to `evals/skills/<name>/`

Two different things can both exist for the same skill and are not redundant:

- `.claude/skills/<name>/evals/` — fixtures + expected findings, portable with the skill, graded
  manually or via the shared runner (once it exists).
- `evals/skills/<name>/*.cases.ts` + `*.eval.ts` — the course harness's vitest-based, LLM-judged,
  quantitative version (`pnpm eval:skills`, `eval:repeat`, `eval:delta`). Not portable (lives in this
  repo's `evals/` package, imports `evals/src/`), but gives repeatable statistics and CI integration.

A skill doesn't need both — write the course-harness pair only once a skill is mature enough to be
worth the heavier machinery (see `TODO-skill-eval-runner.md` for the reasoning).
