# Specs

Specification files for DevDigest features, written using **EARS methodology** and
**Spec-Driven Development (SDD)**. Every non-trivial feature starts with a spec —
before any planning or code is written.

---

## Directory structure

```
specs/                        <- cross-module specs (touch 2+ modules)
  README.md                   <- this file (index + conventions)
  SPEC-NN-<feature>.md        <- individual spec files

server/specs/                 <- server-only specs
client/specs/                 <- client-only specs
reviewer-core/specs/          <- reviewer-core-only specs
e2e/specs/                    <- e2e-only specs
mcp/specs/                    <- mcp-only specs
```

**Rule:** if a spec touches 2+ modules -> goes here. If only 1 module -> goes in that module's `specs/` folder.

---

## Development workflow

```
spec-creator          ->  implementation-planner  ->  implementer
writes SPEC-NN.md        reads spec, runs VRF,       executes PLAN-*.md
                         writes PLAN-*.md
```

1. **spec-creator** -- describe a feature, agent asks blocking questions and produces a `SPEC-YYYY-MM-DD-<feature-name>.md` file
2. **implementation-planner** -- reads the SPEC, verifies requirements (VRF), writes a `PLAN-*.md`
3. **implementer** -- executes the plan, references the spec for AC verification

**Specs are never written manually.** Always use the `spec-creator` agent.

---

## When to write a spec

Write a spec when:
- The feature is non-trivial (touches more than 1 file or has user-facing behavior)
- There are open design questions that need to be answered before coding
- The feature crosses module boundaries (client <-> server <-> reviewer-core)
- A bug fix changes observable behavior

Skip a spec for:
- Typo/copy fixes
- Pure refactors with no behavior change
- Config/tooling changes

---

## Spec file conventions

### Naming

```
SPEC-YYYY-MM-DD-<kebab-case-feature-name>.md
```

Examples: `SPEC-2026-07-01-webhook-notifications.md`, `SPEC-2026-07-15-export-pdf.md`

Date = creation date. Feature Name = kebab-case feature name, 2-4 words. No numeric IDs -- date is the ordering key.

### Status lifecycle

```
draft  ->  approved  ->  implemented
```

- `draft` -- created by spec-creator, open for review
- `approved` -- team confirmed the spec before implementation starts
- `implemented` -- feature is live, spec is frozen

Status is updated **manually** in the spec file header.

### Acceptance criteria format (EARS)

Every AC uses one of five EARS patterns:

| Pattern | Syntax |
|---------|--------|
| Ubiquitous | «Система повинна (shall) ...» |
| Event-driven | «КОЛИ \<подія\>, система повинна (shall) ...» |
| State-driven | «ПОКИ \<стан\>, система повинна (shall) ...» |
| Unwanted behavior | «ЯКЩО \<умова\>, ТОДІ система повинна (shall) ...» |
| Optional feature | «ДЕ \<умова\>, система повинна (shall) ...» |

Vague language ("should work", "handle errors") is not allowed in ACs.

---

## Cross-module spec index

| Spec | Title | Modules | Status |
|------|-------|---------|--------|
| SPEC-2026-07-02-project-context | [Project Context](SPEC-2026-07-02-project-context.md) | server, client | draft |
| SPEC-2026-07-03-pr-why-risk-brief | [PR Why+Risk Brief](SPEC-2026-07-03-pr-why-risk-brief.md) | server, client | draft |
| SPEC-2026-07-04-context-root-scan | [Context Root Scan](SPEC-2026-07-04-context-root-scan.md) | server, client | draft |
| SPEC-2026-07-04-onboarding-generator | [Onboarding Generator (Onboarding Tour)](SPEC-2026-07-04-onboarding-generator.md) | server, client | draft |
| SPEC-2026-07-06-eval-pipeline | [Eval Pipeline](SPEC-2026-07-06-eval-pipeline.md) | server, client | draft |

_This table is updated by `spec-creator` each time a cross-module spec is added._
