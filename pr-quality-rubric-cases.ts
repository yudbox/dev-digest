/**
 * PR Quality Rubric — eval cases for demonstration
 * Skill dimensions: Clarity · Correctness · Edge Cases · Naming · Size
 * 2 cases per dimension = 10 cases total
 * NEGATIVE (no flag, expected []) + POSITIVE (flag, expected finding)
 */

// ── CLARITY ───────────────────────────────────────────────────────────────────
// "Is the code readable without needing the author to explain it?"

export const clarity_negative = {
  name: "clarity-self-explanatory-code-is-not-flagged",
  kind: "NEGATIVE",
  title: "Refactor payment retry to use exponential backoff",
  body: `
Replaces the hard-coded 3s flat delay with exponential backoff.

const BACKOFF_BASE_MS = 500;
const MAX_RETRY_ATTEMPTS = 5;

function calculateBackoffDelay(attemptNumber: number): number {
  return BACKOFF_BASE_MS * Math.pow(2, attemptNumber);
}

async function retryFailedPayment(paymentId: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
    const succeeded = await processPayment(paymentId);
    if (succeeded) return;
    await sleep(calculateBackoffDelay(attempt));
  }
  throw new PaymentExhaustedError(paymentId);
}
  `.trim(),
  expectedOutput: `[]`,
};

export const clarity_positive = {
  name: "clarity-cryptic-single-letter-names-trigger-a-flag",
  kind: "POSITIVE",
  title: "fix",
  body: `
tweaked stuff

const x = 500;
const n = 5;

function f(a: number) {
  return x * (2 ** a);
}

async function r(id: string) {
  for (let i = 0; i < n; i++) {
    const ok = await p(id);
    if (ok) return;
    await s(f(i));
  }
  throw new Error('err');
}
  `.trim(),
  expectedOutput: `[{"dimension":"Clarity","score":2,"reason":"Single-letter identifiers (x, n, f, r, p, s) make the code unreadable without running it. The PR title 'fix' gives no context about intent."}]`,
};

// ── CORRECTNESS ───────────────────────────────────────────────────────────────
// "Are there obvious bugs, off-by-one errors, or logic issues?"

export const correctness_negative = {
  name: "correctness-correct-pagination-offset-is-not-flagged",
  kind: "NEGATIVE",
  title: "Add pagination to user list endpoint",
  body: `
Adds limit/offset pagination to GET /users.

async function listUsers(page: number, pageSize: number) {
  const offset = (page - 1) * pageSize;
  return db.select().from(users).limit(pageSize).offset(offset);
}
  `.trim(),
  expectedOutput: `[]`,
};

export const correctness_positive = {
  name: "correctness-off-by-one-in-pagination-is-flagged",
  kind: "POSITIVE",
  title: "Paginate search results",
  body: `
Adds pagination to the search endpoint.

async function searchItems(page: number, pageSize: number) {
  const offset = page * pageSize;
  return db.select().from(items).limit(pageSize).offset(offset);
}
  `.trim(),
  expectedOutput: `[{"dimension":"Correctness","score":1,"reason":"Off-by-one bug: offset = page * pageSize skips the first page when page=1 (offset=pageSize). Should be (page - 1) * pageSize for 1-based pagination."}]`,
};

// ── EDGE CASES ────────────────────────────────────────────────────────────────
// "Does the code handle null/undefined, empty collections, and boundary values?"

export const edgecases_negative = {
  name: "edge-cases-empty-array-and-null-are-handled",
  kind: "NEGATIVE",
  title: "Add tag filtering to product search",
  body: `
Filters products by tags when provided; returns all products otherwise.

function filterByTags(products: Product[], tags: string[] | null): Product[] {
  if (!tags || tags.length === 0) return products;
  return products.filter((p) => tags.every((t) => p.tags.includes(t)));
}
  `.trim(),
  expectedOutput: `[]`,
};

export const edgecases_positive = {
  name: "edge-cases-missing-empty-check-on-reviews-array-is-flagged",
  kind: "POSITIVE",
  title: "Show latest review score on product card",
  body: `
Displays the most recent review score next to each product.

function getLatestScore(reviews: Review[]): number {
  return reviews[0].score;
}
  `.trim(),
  expectedOutput: `[{"dimension":"Edge cases","score":1,"reason":"reviews[0].score throws if reviews is an empty array. There is no guard for the case where a product has no reviews yet."}]`,
};

// ── NAMING ────────────────────────────────────────────────────────────────────
// "Are variables, functions, and types named to reveal intent?"

export const naming_negative = {
  name: "naming-descriptive-function-and-param-names-are-not-flagged",
  kind: "NEGATIVE",
  title: "Extract discount calculation into a reusable helper",
  body: `
Moves inline discount math into a named helper so it can be reused across the checkout flow.

function calculateDiscountedPrice(
  basePrice: number,
  discountPercentage: number
): number {
  return basePrice * (1 - discountPercentage / 100);
}
  `.trim(),
  expectedOutput: `[]`,
};

export const naming_positive = {
  name: "naming-ambiguous-single-word-params-and-temp-vars-are-flagged",
  kind: "POSITIVE",
  title: "Add helper for price calculation",
  body: `
Quick utility for the checkout.

function process(data: any, val: number): number {
  const temp = data.base * (1 - val / 100);
  const res = temp < 0 ? 0 : temp;
  return res;
}
  `.trim(),
  expectedOutput: `[{"dimension":"Naming","score":2,"reason":"process, data, val, temp, and res reveal no intent. The function name 'process' could mean anything; 'data.base' hides what the object actually is; 'val' does not indicate it is a percentage."}]`,
};

// ── SIZE ──────────────────────────────────────────────────────────────────────
// "Is the PR small enough to review meaningfully in one sitting (< 400 lines changed)?"

export const size_negative = {
  name: "size-small-focused-change-is-not-flagged",
  kind: "NEGATIVE",
  title: "Fix wrong HTTP status code on missing resource",
  body: `
Returns 404 instead of 500 when a requested item does not exist.

1 file changed, 4 lines affected.

throw new NotFoundError('item not found') instead of throwing a generic Error.
  `.trim(),
  expectedOutput: `[]`,
};

export const size_positive = {
  name: "size-large-cross-cutting-refactor-is-flagged",
  kind: "POSITIVE",
  title: "Refactor entire auth module to use JWT",
  body: `
Replaces session-based auth with JWT across the whole app.

18 files changed, 670 lines added, 410 lines removed.
Touches: middleware, all route guards, user service, token service,
client auth context, 3 test suites, env config, README.
  `.trim(),
  expectedOutput: `[{"dimension":"Size","score":1,"reason":"670 lines added across 18 files far exceeds the 400-line threshold. The PR spans middleware, services, client, tests, and docs — too large to review meaningfully in one sitting. Consider splitting into: (1) server-side JWT plumbing, (2) client auth context, (3) route guard migration."}]`,
};

// # PR Quality Rubric

// Score the pull request on the following dimensions:

// 1. **Clarity** — Is the code readable without needing the author to explain it?
// 2. **Correctness** — Are there obvious bugs, off-by-one errors, or logic issues?
// 3. **Edge cases** — Does the code handle null/undefined, empty collections, and boundary values?
// 4. **Naming** — Are variables, functions, and types named to reveal intent?
// 5. **Size** — Is the PR small enough to review meaningfully in one sitting (< 400 lines changed)?

// Flag any dimension that scores below 3/5.

// 2. **Correctness** — Does the code follow the project's formatting and style conventions?
