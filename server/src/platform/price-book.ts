import type { ModelInfo } from '@devdigest/shared';

type Estimator = (model: string, tokensIn: number, tokensOut: number) => number | null;

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

type Price = { in: number; out: number };

/**
 * Normalizes a model id for cross-provider price matching: strips a vendor
 * prefix ("anthropic/claude-sonnet-4.6" → "claude-sonnet-4.6"), a variant
 * suffix (":batch", ":free"), and all separators/case, so IDs that differ
 * only in naming convention between a direct provider and OpenRouter's
 * catalog collapse to the same key — e.g. Anthropic's own `claude-sonnet-4-6`
 * and OpenRouter's `anthropic/claude-sonnet-4.6:batch` both become
 * "claudesonnet46".
 */
function canonicalizeModelId(id: string): string {
  const last = id.split('/').pop() ?? id;
  return last.split(':')[0]!.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function calcCost(p: Price, tokensIn: number, tokensOut: number): number {
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}

/**
 * Live OpenRouter pricing for cost attribution (Settings spec, Feature 2).
 *
 * OpenRouter's `/models` endpoint returns per-model prices (USD per 1M tokens),
 * so we cache them and use them for `estimateCost` instead of relying on a
 * hardcoded table for the models we actually run. The cache refreshes lazily
 * (non-blocking) on a TTL; until it is warm — and for non-OpenRouter models,
 * whose APIs don't expose prices — we fall back to the static table, and
 * finally to an approximate cross-provider match (see `canonicalizeModelId`)
 * against OpenRouter's catalog, since it proxies the same models (Anthropic,
 * OpenAI, …) under its own naming. Approximate on purpose: a direct-provider
 * model the static table hasn't been updated for still gets a ballpark cost
 * instead of silently showing "n/a".
 *
 * `estimate` is SYNCHRONOUS by design: it is injected into each provider's
 * per-call cost hook, which cannot await. The first call after a cold start
 * (or expiry) returns the fallback while a refresh runs in the background;
 * subsequent calls use the live prices.
 */
export class PriceBook {
  private prices = new Map<string, Price>();
  private canonicalPrices = new Map<string, Price>();
  private expires = 0;
  private refreshing = false;

  constructor(
    private listOpenRouterModels: () => Promise<ModelInfo[]>,
    private fallback: Estimator,
    private ttlMs = SIX_HOURS_MS,
    private now: () => number = () => Date.now(),
  ) {}

  /**
   * Synchronous cost in USD: exact live OpenRouter price if cached, else the
   * static fallback table, else an approximate match against OpenRouter's
   * catalog by canonicalized model id, else null (truly unknown everywhere).
   */
  estimate(model: string, tokensIn: number, tokensOut: number): number | null {
    this.maybeRefresh();
    const exact = this.prices.get(model);
    if (exact) return calcCost(exact, tokensIn, tokensOut);

    const staticPrice = this.fallback(model, tokensIn, tokensOut);
    if (staticPrice != null) return staticPrice;

    const approx = this.canonicalPrices.get(canonicalizeModelId(model));
    return approx ? calcCost(approx, tokensIn, tokensOut) : null;
  }

  /** Force a synchronous-await refresh (e.g. to warm the cache). Never throws. */
  async refresh(): Promise<void> {
    try {
      this.ingest(await this.listOpenRouterModels());
      this.expires = this.now() + this.ttlMs;
    } catch {
      this.expires = 0;
    }
  }

  private ingest(models: ModelInfo[]): void {
    for (const m of models) {
      if (m.pricing) {
        const price = { in: m.pricing.promptPerM, out: m.pricing.completionPerM };
        this.prices.set(m.id, price);
        // First variant seen for a canonical id wins (e.g. prefer the plain
        // listing over a later ":batch"/":free" one) — approximate anyway.
        const key = canonicalizeModelId(m.id);
        if (!this.canonicalPrices.has(key)) this.canonicalPrices.set(key, price);
      }
    }
  }

  private maybeRefresh(): void {
    if (this.refreshing) return;
    if (this.now() < this.expires && this.prices.size > 0) return;
    this.refreshing = true;
    this.expires = this.now() + this.ttlMs; // set early so concurrent calls don't stampede
    this.listOpenRouterModels()
      .then((models) => this.ingest(models))
      .catch(() => {
        this.expires = 0; // allow a retry on the next call
      })
      .finally(() => {
        this.refreshing = false;
      });
  }
}
