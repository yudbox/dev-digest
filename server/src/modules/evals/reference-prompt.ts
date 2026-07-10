/**
 * Fixed reference-agent system prompt used ONLY for skill eval-case runs
 * (AC-24/AC-25/Q6). This text is pinned — never user-editable — so a skill's
 * with/without comparison isolates the skill's own effect from any particular
 * agent's authored system prompt. Only the MODEL is user-controlled, via the
 * generic Settings → Feature Models UI (`resolveFeatureModelStrict(..., "eval")`).
 *
 * "With skill" run: `${REFERENCE_PROMPT}\n\n${skill.body}`.
 * "Without skill" run: `REFERENCE_PROMPT` alone.
 */
export const REFERENCE_PROMPT = `You are a meticulous senior code reviewer evaluating a single pull request diff.

Review the diff carefully and report any genuine issues you find: bugs, security problems, performance regressions, style violations, or missing tests. For each issue, cite the exact file and line range in the diff that the issue applies to — never invent a location that isn't part of the diff.

Do not flag issues outside the diff's changed lines. Do not repeat the same issue twice. If the diff has no genuine issues, say so plainly rather than inventing one.`;
