# onion-architecture — manual eval notes

Six fixtures under `fixtures/`, each with exactly one (or two) uncommented violations, cross-checked
against `expected-findings.json`. No fixture contains a comment or hint revealing the planted issue —
detection has to come from actually knowing the Core Principles in `SKILL.md`.

## Eval 0 — fixture-1-notifications

Thin-routes violation (Core Principle 5): role/unread filtering done inline in `routes.ts`. Plus a
composition-root violation (Core Principle 3): repository instantiated inside the handler instead of
pulled from `container`. Tests whether the skill catches two *different* principles in the same file.

## Eval 1 — fixture-2-labels

Drizzle-leaks-into-service violation (Core Principle 4): `service.ts` queries the `labels` table
directly, ignoring the sibling `repository.ts` that already exists in the fixture. Tests whether the
skill notices an *unused* repository as evidence the service is doing the repository's job itself,
not just "does a repository file exist somewhere."

## Eval 2 — fixture-3-webhooks

Two violations: an inward-only-dependencies violation (Core Principle 1, critical) — infrastructure
importing from application (`repository.ts` importing `normalizeDeliveryStatus` from `service.ts`) —
and a lesser composition-root violation (Core Principle 3) — one repository constructing another
repository itself. Tests whether the skill can tell these apart by severity rather than flattening
both into one generic "layering" finding.

## Eval 3 — fixture-4-exports

Adapter instantiated inside a service constructor (Core Principle 3) plus a Fastify type
(`FastifyReply`) imported into the application layer (Core Principle 1). Tests whether the skill
flags a framework-type import as a *distinct* finding from the `new Adapter()` instantiation, since
both live in the same file and could be conflated into a single vague note.

## Eval 4 — fixture-5-rate-limits (Core Principle 7)

Planted **specifically to test the new "Config/secrets flow through the Container only" rule** in
isolation. Earlier attempts at this rule were confounded: `process.env` reads always showed up
*alongside* an adapter-instantiation violation, so an old skill version without the rule could still
flag the file (for the wrong reason) and look like it "passed." This fixture has **no** `new
ConcreteClass()` call anywhere — the only issue is two direct `process.env.RATE_LIMIT_*` reads inside
`RateLimitsRepository`. A skill version without Core Principle 7 has nothing else in this file to
false-positive on, so this is a clean before/after discriminator. Compare with/without the rule via:

```bash
cd evals && pnpm eval:repeat skills/onion-architecture/onion-architecture.eval.ts --label with-rule-7
# ...temporarily revert Core Principle 7 in SKILL.md + di-container.md...
cd evals && pnpm eval:repeat skills/onion-architecture/onion-architecture.eval.ts --label without-rule-7
pnpm eval:delta without-rule-7 with-rule-7
```

## Eval 5 — fixture-6-review-summaries (Core Principle 8)

Planted to test the "No N+1 repository calls from services" rule. `summarizeRecent` loops over
`ids`, calling `findById` *and* `countRunsForPr` per iteration — two separate single-item repository
calls repeated per id, not just one. Tests whether the skill flags **both** calls inside the loop as
the same violation (per SKILL.md: "This applies to every per-item repository call inside a loop, not
just the primary fetch") rather than only catching the first and missing the second as a distinct
instance of the same pattern.
