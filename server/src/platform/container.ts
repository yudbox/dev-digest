import type {
  AuthProvider,
  SecretsProvider,
  VcsClient,
  VcsProvider,
  GitClient,
  CodeIndex,
  Embedder,
  LLMProvider,
} from "@devdigest/shared";
import type { AppConfig } from "./config.js";
import type { Db } from "../db/client.js";
import { JobRunner } from "./jobs.js";
import { runBus, type RunBus } from "./sse.js";
import { LocalSecretsProvider } from "../adapters/secrets/local.js";
import { LocalNoAuthProvider } from "../adapters/auth/local.js";
import { OctokitGitHubClient } from "../adapters/github/octokit.js";
import { AzureDevOpsClient } from "../adapters/azure-devops/client.js";
import { SimpleGitClient } from "../adapters/git/simple-git.js";
import { RipgrepCodeIndex } from "../adapters/codeindex/ripgrep.js";
import { OpenAIProvider } from "../adapters/llm/openai.js";
import { AnthropicProvider } from "../adapters/llm/anthropic.js";
import { OpenAIEmbedder } from "../adapters/embedder/openai.js";
import { OpenRouterProvider } from "@devdigest/reviewer-core";
import { estimateCost } from "../adapters/llm/pricing.js";
import { PriceBook } from "./price-book.js";
import { ConfigError } from "./errors.js";
import { AgentsRepository } from "../modules/agents/repository.js";
import { SkillsRepository } from "../modules/skills/repository.js";
import { ReviewRepository } from "../modules/reviews/repository.js";
import { RepoRepository } from "../modules/repos/repository.js";
import { EvalsRepository } from "../modules/evals/repository.js";
import { CiRepository } from "../modules/ci/repository.js";
import { MemoryRepository } from "../modules/memory/repository.js";
import type { RepoIntel } from "../modules/repo-intel/types.js";
import { RepoIntelService } from "../modules/repo-intel/service.js";
import { type DepGraph, DepCruiseGraph } from "../adapters/depgraph/index.js";
import {
  type Tokenizer,
  TiktokenTokenizer,
} from "../adapters/tokenizer/index.js";
import { ContextService } from "../modules/context/service.js";
import { OnboardingService } from "../modules/onboarding/service.js";

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  /**
   * @deprecated Use `vcs: { github: ... }` instead. Kept so the many existing
   * test files that already pass `overrides: { github: new MockGitHubClient() }`
   * keep compiling AND behaving identically — `Container.vcs()` falls back to
   * this field when `provider === 'github'` and `vcs.github` wasn't given.
   */
  github?: VcsClient;
  /**
   * Pre-built VCS clients by provider id (skip secret lookup). The preferred
   * injection point going forward — `{ vcs: { github: ..., 'azure-devops': ... } }`.
   */
  vcs?: Partial<Record<VcsProvider, VcsClient>>;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<"openai" | "anthropic" | "openrouter", LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** repo-intel T3 adapters — only the indexer pipeline reads these. */
  depgraph?: DepGraph;
  tokenizer?: Tokenizer;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();
  /** VCS client cache, keyed by `repo.vcsProvider` — same pattern as `llmCache`. */
  private vcsCache = new Map<string, VcsClient>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _skillsRepo?: SkillsRepository;
  private _reviewRepo?: ReviewRepository;
  private _reposRepo?: RepoRepository;
  private _evalsRepo?: EvalsRepository;
  private _ciRepo?: CiRepository;
  private _memoryRepo?: MemoryRepository;
  private _repoIntel?: RepoIntel;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;
  private _contextService?: ContextService;
  private _onboarding?: OnboardingService;

  constructor(
    config: AppConfig,
    db: Db,
    private overrides: ContainerOverrides = {},
  ) {
    this.config = config;
    this.db = db;
    this.secrets =
      overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get contextService(): ContextService {
    return (this._contextService ??= new ContextService(this));
  }

  get onboarding(): OnboardingService {
    return (this._onboarding ??= new OnboardingService(this));
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get skillsRepo(): SkillsRepository {
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  get reposRepo(): RepoRepository {
    return (this._reposRepo ??= new RepoRepository(this.db));
  }

  get evalsRepo(): EvalsRepository {
    return (this._evalsRepo ??= new EvalsRepository(this.db));
  }

  get ciRepo(): CiRepository {
    return (this._ciRepo ??= new CiRepository(this.db));
  }

  get memoryRepo(): MemoryRepository {
    return (this._memoryRepo ??= new MemoryRepository(this.db));
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /** Token counter (js-tiktoken) for the repo-map budget search. */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get("OPENROUTER_API_KEY");
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  /**
   * Resolve the `VcsClient` for a repo, dispatching by `repo.vcsProvider` —
   * same cached-by-key pattern as `llm(id)` below. `repo.vcsProvider` is
   * typed as `string` here (not the narrower `VcsProvider`) because callers
   * pass Drizzle `repos` rows straight through: the column is TEXT+CHECK at
   * the DB layer (see TASK-001), not a TS-level literal union, so widening
   * the parameter avoids an `as VcsProvider` cast at every call site — the
   * cast happens once, here, in the composition root.
   */
  async vcs(repo: { vcsProvider: string }): Promise<VcsClient> {
    const provider = repo.vcsProvider as VcsProvider;
    const injected =
      this.overrides.vcs?.[provider] ??
      (provider === "github" ? this.overrides.github : undefined);
    if (injected) return injected;
    const cached = this.vcsCache.get(provider);
    if (cached) return cached;
    const client = await this.buildVcs(provider);
    this.vcsCache.set(provider, client);
    return client;
  }

  private async buildVcs(provider: VcsProvider): Promise<VcsClient> {
    if (provider === "github") {
      const token = await this.secrets.get("GITHUB_TOKEN");
      if (!token) throw new ConfigError("GITHUB_TOKEN is not configured");
      return new OctokitGitHubClient(token);
    }
    if (provider === "azure-devops") {
      // TASK-006 — composition root is the ONLY place `new AzureDevOpsClient`
      // may appear (Architecture Notes: "Composition root неприкосновенен").
      // Construction takes only the workspace-level PAT — org/baseUrl vary
      // per repo and are resolved per-call from the `RepoRef` the caller
      // passes to each `VcsClient` method (see `AzureDevOpsClient`'s own
      // docstring for why this differs from GitHub's single-host client).
      const token = await this.secrets.get("AZURE_DEVOPS_TOKEN");
      if (!token) throw new ConfigError("AZURE_DEVOPS_TOKEN is not configured");
      return new AzureDevOpsClient(token);
    }
    throw new ConfigError(`Unknown vcs_provider: ${provider as string}`);
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: "openai" | "anthropic" | "openrouter"): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  private async buildLlm(
    id: "openai" | "anthropic" | "openrouter",
  ): Promise<LLMProvider> {
    if (id === "openai") {
      const key = await this.secrets.get("OPENAI_API_KEY");
      if (!key) throw new ConfigError("OPENAI_API_KEY is not configured");
      return new OpenAIProvider(key);
    }
    if (id === "openrouter") {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get("OPENROUTER_API_KEY");
      if (!key) throw new ConfigError("OPENROUTER_API_KEY is not configured");
      return new OpenRouterProvider(key, {
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get("ANTHROPIC_API_KEY");
    if (!key) throw new ConfigError("ANTHROPIC_API_KEY is not configured");
    return new AnthropicProvider(key);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError(
        "Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)",
      );
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm("openai");
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this.vcsCache.clear();
    this._embedder = undefined;
  }
}
