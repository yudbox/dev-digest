# Review Pipeline

Full detail of each step in `reviewer-core`. Entry point:
`reviewPullRequest(input: ReviewInput): Promise<ReviewOutcome>` (`src/review/run.ts`).

The engine performs **no I/O** beyond the injected `LLMProvider`: no DB, GitHub,
filesystem, memory retrieval or persistence. The caller resolves skills, memory
and specs into plain strings and persists the outcome.

## Input

```typescript
type ReviewInput = {
  systemPrompt: string      // agent system prompt (trusted)
  model: string
  diff: UnifiedDiff         // parsed diff; hunks carry new-side line numbers
  llm: LLMProvider          // injected
  strategy?: 'auto' | 'single-pass' | 'map-reduce'
  skills?: string[]         // resolved skill BODIES, in order (labelled S1…Sn)
  memory?: string[]         // curated memory items
  specs?: string[]          // project-context chunks (untrusted, wrapped)
  callers?: string          // callers-of-changed-symbols digest (untrusted)
  repoMap?: string          // repo skeleton (untrusted)
  prDescription?: string    // PR body (untrusted, truncated to 4000 chars)
  intent?: string           // derived intent + scope (untrusted)
  task?: string             // framing line, e.g. "Review PR #482"
  maxRetries?: number
  mapThresholdLines?: number
  sessionId?: string        // OpenRouter session grouping
  onEvent?: (e: ReviewEvent) => void
  checkCancelled?: () => void
}
```

## Step 1: choose the strategy

- `single-pass` — one call for the whole diff.
- `map-reduce` — one call per changed file, results reduced afterwards.
- `auto` (default) — map-reduce only when the diff exceeds
  `DEFAULT_MAP_THRESHOLD_LINES` (400 added+deleted lines) **and** touches more than one file.

## Step 2: assemblePrompt()

Builds the `system` and `user` messages, plus the `PromptAssembly` record kept in
the run trace.

```
system message:
  [agent systemPrompt]
  [INJECTION_GUARD]            ← always appended, non-negotiable

user message (sections omitted when empty):
  [task]
  ## PR description            ← wrapUntrusted("pr-description")
  ## PR intent and scope       ← wrapUntrusted("intent")
  ## Skills / rules            ← labelled [S1]…[Sn] + the labels instruction
  ## Relevant memory
  ## Repo skeleton             ← wrapUntrusted("repo-map")
  ## Project context           ← wrapUntrusted("spec-N")
  ## Callers of changed symbols← wrapUntrusted("callers")
  ## Diff to review            ← wrapUntrusted("diff")
```

### Skill labels

Each skill body is rendered as `[S1]\n<body>`, `[S2]\n<body>`, … in input order.
`skillLabel(i)` (exported) is the single source of the `S<i+1>` format; the server
uses it to map labels back to skill ids. A short trusted instruction above the
skills asks the model to:

- list the labels of the rules relevant to this diff in `skills_applied` (review level);
- list, per finding, the labels of the rules that produced it in `rule_refs`;
- use only these labels, and leave the lists empty when nothing applies.

All enabled skills still go into the prompt — labelling never filters them. Labels
are advisory data from the model: the **server** drops any label that does not map
to a skill loaded in that run, and labels are never used as ids directly.

## Step 3: wrapUntrusted() and INJECTION_GUARD

`wrapUntrusted(label, content)` fences untrusted content as
`<untrusted source="label">…</untrusted>` and escapes any `</untrusted>` inside it.
`INJECTION_GUARD` (appended to the system prompt) tells the model that everything
inside those blocks is data, never instructions, and that claims such as "test
fixture" or "intentional" never reduce the review. The two work as a pair; never
remove either, and never concatenate untrusted content into the system prompt.

## Step 4: LLMProvider.completeStructured()

One call per chunk, with the Zod `Review` schema converted to JSON Schema
(`toJsonSchema`). The provider validates the response with `parseWithRepair` and
re-prompts up to `maxRetries` times. The result carries `tokensIn`, `tokensOut`,
`costUsd` and `costSource`:

| `costSource` | Meaning |
|---|---|
| `'api'` | the provider reported the billed cost (OpenRouter `usage.cost`) |
| `'estimate'` | computed from tokens × a price table (the direct OpenAI / Anthropic adapters; the OpenRouter fallback) |
| `null` | cost unknown |

## Step 5: reduceReviews()

Single chunk → returned as is. Several chunks → findings concatenated, worst
verdict wins, mean score, summaries joined, and `skills_applied` is the
first-seen **union** of the chunks' lists (`undefined` when every chunk omitted it,
which is different from a chunk explicitly reporting none).

## Step 6: groundFindings() — mandatory gate

For each finding: the file must be in the diff, and `start_line..end_line` must
intersect a hunk's new-side lines. Full-file kinds (`secret_leak`,
`lethal_trifecta`, `phantom`, `hook`) only need the file to be present. Anything
else is dropped with a reason. The gate is unconditional — it runs even when the
model returns perfectly valid JSON. A finding dropped here takes its `rule_refs`
with it.

The final `score` is derived **deterministically from the surviving findings**
(`scoreFromFindings`: 100 minus 35 / 12 / 3 per CRITICAL / WARNING / SUGGESTION),
not from the model's self-reported number.

## Output

```typescript
type ReviewOutcome = {
  review: Review              // grounded findings, deterministic score
  grounding: string           // e.g. "3/4 passed"
  dropped: { finding: Finding; reason: string }[]
  mode: 'single-pass' | 'map-reduce'
  assembly: PromptAssembly    // for the run trace
  chunks: { label: string }[]
  tokensIn: number
  tokensOut: number
  costUsd: number | null
  costSource: 'api' | 'estimate' | null
  skillsApplied: string[] | null
  raw: string
}
```

- `costSource` is `'api'` only when **every** chunk reported a provider cost;
  `'estimate'` when any chunk was estimated; `null` when the total cost is unknown.
- `skillsApplied` is the union of skill labels over chunks; `null` means the model
  never reported the field (unknown, not "no skill applied"). It is engine metadata
  and is **not** part of `review`.

```typescript
type Review = {
  verdict: 'approve' | 'request_changes' | 'comment'
  summary: string
  score: number               // 0–100, recomputed post-grounding
  findings: Finding[]
}

type Finding = {
  id: string
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION'
  category: 'bug' | 'security' | 'perf' | 'style' | 'test'
  title: string
  file: string
  start_line: number
  end_line: number
  rationale: string           // markdown
  suggestion?: string | null
  confidence: number          // 0–1
  kind?: string | null
  rule_refs?: string[] | null // skill labels in engine output; skill ids once persisted
}
```
