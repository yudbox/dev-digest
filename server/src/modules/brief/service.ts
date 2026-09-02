import type { Container } from "../../platform/container.js";
import type { Brief, IssueMeta, Provider, SmartDiff } from "@devdigest/shared";
import { Brief as BriefSchema } from "@devdigest/shared";
import { resolveFeatureModelStrict } from "../settings/feature-models.js";
import { BlastService } from "../blast/service.js";
import { PullsService } from "../pulls/service.js";
import { NotFoundError } from "../../platform/errors.js";
import { getCachedBrief, upsertBrief, withAdvisoryLock } from "./repository.js";

// Rough token estimate: 1 token ≈ 4 chars (good enough for budget enforcement)
const estimateTokens = (text: string) => Math.ceil(text.length / 4);

const MAX_INPUT_TOKENS = 8000;
const MAX_SPECS_TOKENS = 3000; // specs are the first thing truncated

const BRIEF_SYSTEM_PROMPT =
  "You are a PR triage assistant. Given structured metadata about a pull request " +
  "(intent summary, blast radius summary, smart-diff stats by group, and optional " +
  "spec excerpts), produce a concise PR brief. " +
  "Rules:\n" +
  "- `what`: one clear sentence of what the PR does (no leading 'This PR...')\n" +
  "- `why`: one-two sentences on motivation or business reason\n" +
  "- `risk_level`: 'high' if any security/data/api_change risk or many core-file changes; " +
  "'low' if boilerplate-only changes; otherwise 'medium'\n" +
  "- `risks[]`: 1-5 concrete risks with file references from changed files; " +
  "each risk must have kind, title, explanation, severity, and file_refs. " +
  "Only use file paths that appear in the context. Empty array is valid.\n" +
  "- `review_focus[]`: 2-4 areas reviewer must check, each with a label and relevant file paths. " +
  "Discard any item with no valid file paths. Empty array is valid.\n" +
  "Always respond in English.";

export class BriefService {
  private readonly blastService: BlastService;
  private readonly pullsService: PullsService;

  constructor(private readonly container: Container) {
    this.blastService = new BlastService(container);
    this.pullsService = new PullsService(container.reviewRepo);
  }

  async generate(
    workspaceId: string,
    prId: string,
    force: boolean,
    log: { info: (msg: string) => void },
  ): Promise<Brief> {
    return withAdvisoryLock(this.container.db, prId, async () => {
      // 1. Resolve pull request
      const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
      if (!pull) throw new NotFoundError("Pull request not found");

      // 2. Cache check (inside the lock so concurrent requests don't double-gen)
      if (!force) {
        const cached = await getCachedBrief(this.container.db, prId);
        if (cached && cached.headSha === pull.headSha) {
          log.info("Brief: cache hit (headSha unchanged)");
          return cached.brief;
        }
      }

      // 3. Resolve LLM
      const { provider, model } = await resolveFeatureModelStrict(
        this.container,
        workspaceId,
        "risk_brief",
      );
      let llm;
      try {
        llm = await this.container.llm(provider as Provider);
      } catch (err) {
        throw new Error(
          `Brief: LLM provider "${provider}" not configured — ${(err as Error).message}`,
        );
      }

      // 4. Collect inputs (no diff bodies)
      const [intent, blastResult, smartDiff, repoRow] = await Promise.all([
        this.container.reviewRepo.getIntent(prId),
        this.blastService.getForPr(prId, workspaceId).catch(() => null),
        this.pullsService.buildSmartDiff(workspaceId, prId).catch(() => null),
        this.container.reviewRepo.getRepo(pull.repoId).catch(() => null),
      ]);

      // 4b. Best-effort: linked issue from PR body ("Closes/Fixes/Resolves #N")
      let linkedIssue: IssueMeta | undefined;
      if (pull.body && repoRow) {
        const m = pull.body.match(/(Closes|Fixes|Resolves)\s+#(\d+)/i);
        if (m) {
          const issueNumber = parseInt(m[2]!, 10);
          try {
            const gh = await this.container.vcs(repoRow);
            linkedIssue = await gh.getIssue(
              {
                owner: repoRow.owner,
                name: repoRow.name,
                project: repoRow.project ?? undefined,
                baseUrl: repoRow.baseUrl ?? undefined,
              },
              issueNumber,
            );
            log.info(
              `Brief: linked issue #${issueNumber} fetched — "${linkedIssue?.title}"`,
            );
          } catch {
            log.info(
              `Brief: linked issue #${issueNumber} fetch failed — skipping`,
            );
          }
        }
      }

      // Collect known file paths for grounding gate
      const knownPaths = new Set<string>();
      if (smartDiff) {
        for (const g of smartDiff.groups) {
          for (const f of g.files) knownPaths.add(f.path);
        }
      }
      if (blastResult?.changedSymbols) {
        for (const s of blastResult.changedSymbols) knownPaths.add(s.file);
      }

      // 5. Build prompt sections
      const sections: string[] = [];

      // Intent
      if (intent) {
        sections.push(
          `## Intent\nSummary: ${intent.intent}\nIn scope: ${intent.in_scope.join("; ")}\nOut of scope: ${intent.out_of_scope.join("; ")}`,
        );
      } else {
        sections.push(`## Intent\nPR #${pull.number}: ${pull.title}`);
      }

      // Linked issue
      if (linkedIssue) {
        sections.push(
          `## Linked Issue\n#${linkedIssue.number}: ${linkedIssue.title}\n<untrusted source="issue:${linkedIssue.number}">\n${(linkedIssue.body ?? "").slice(0, 1000).replaceAll("</untrusted>", "<\\/untrusted>")}\n</untrusted>`,
        );
      }

      // Blast summary
      if (blastResult?.summary) {
        sections.push(`## Blast Radius Summary\n${blastResult.summary}`);
      } else if (blastResult?.changedSymbols?.length) {
        sections.push(
          `## Changed Symbols\n${blastResult.changedSymbols.map((s) => `${s.file}: ${s.name} (${s.kind})`).join("\n")}`,
        );
      }

      // Smart-diff stats (no bodies)
      if (smartDiff?.groups?.length) {
        const statsLines = smartDiff.groups.map((g) => {
          const files = g.files.length;
          const add = g.files.reduce((s, f) => s + f.additions, 0);
          const del = g.files.reduce((s, f) => s + f.deletions, 0);
          return `${g.role}: ${files} files (+${add}/-${del})`;
        });
        sections.push(`## Diff Stats by Group\n${statsLines.join("\n")}`);
      }

      // Context specs (lowest priority — truncated first).
      // Use enabled agents' contextDocPaths — human-curated relevance signal,
      // same paths resolved by run-executor.ts for actual review runs.
      let specsSection = "";
      try {
        if (repoRow?.clonePath) {
          const enabledAgents =
            await this.container.agentsRepo.listEnabled(workspaceId);
          const allPaths = enabledAgents.flatMap(
            (a) => (a.contextDocPaths as string[] | null) ?? [],
          );
          const dedupedPaths = [...new Set(allPaths)].filter(
            (p) => !p.includes(".."),
          );
          if (dedupedPaths.length > 0) {
            const specDocs =
              await this.container.contextService.readDocsByPaths(
                repoRow.clonePath,
                dedupedPaths,
              );
            const specText = specDocs
              .map(
                (d) =>
                  `<untrusted source="spec:${d.path}">\n${d.content.slice(0, 1500).replaceAll("</untrusted>", "<\\/untrusted>")}\n</untrusted>`,
              )
              .join("\n\n");
            if (specText && estimateTokens(specText) <= MAX_SPECS_TOKENS) {
              specsSection = `## Relevant Specs\n${specText}`;
            }
          }
        }
      } catch {
        // context docs are optional — silently skip on any error
      }

      // 6. Token budget enforcement — drop specs first, then other sections
      let payload = sections.join("\n\n");
      if (specsSection) {
        const withSpecs = `${payload}\n\n${specsSection}`;
        payload =
          estimateTokens(withSpecs) <= MAX_INPUT_TOKENS ? withSpecs : payload;
      }
      // If still over budget, trim oldest sections from the front
      while (
        estimateTokens(payload) > MAX_INPUT_TOKENS &&
        sections.length > 1
      ) {
        sections.shift();
        payload = sections.join("\n\n");
      }

      log.info(
        `Brief: input ~${estimateTokens(payload)} est. tokens, model=${model}`,
      );

      // 7. LLM structured call
      let briefData: Brief;
      try {
        const result = await llm.completeStructured({
          model,
          schema: BriefSchema,
          schemaName: "Brief",
          messages: [
            { role: "system", content: BRIEF_SYSTEM_PROMPT },
            { role: "user", content: payload },
          ],
          temperature: 0.2,
          maxTokens: 1200,
        });
        briefData = BriefSchema.parse(result.data);
      } catch (err) {
        throw new Error(`Brief: LLM call failed — ${(err as Error).message}`);
      }

      // 8. Grounding gate — remove hallucinated file paths
      briefData = {
        ...briefData,
        risks: briefData.risks.map((r) => ({
          ...r,
          file_refs:
            knownPaths.size > 0
              ? r.file_refs.filter((f) => knownPaths.has(f))
              : r.file_refs,
        })),
        review_focus:
          knownPaths.size > 0
            ? briefData.review_focus
                .map((item) => ({
                  ...item,
                  file_refs: item.file_refs.filter((f) => knownPaths.has(f)),
                }))
                .filter((item) => item.file_refs.length > 0)
            : briefData.review_focus,
      };

      // 9. Persist to cache
      await upsertBrief(this.container.db, prId, briefData, pull.headSha ?? "");

      return briefData;
    });
  }
}
