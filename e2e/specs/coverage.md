# Spec: E2E Coverage

What is covered, what is not, and why.

## Covered Flows (L01)

| Flow | File | What it verifies |
|------|------|-----------------|
| `boot` | `flows/boot.json` | App loads at `/`, no JS crash, page title renders |
| `repo-list` | `flows/repo-list.json` | Repos page shows seeded `acme/payments-api` |
| `repo-detail` | `flows/repo-detail.json` | PR list loads for the seeded repo |
| `agents` | `flows/agents.json` | Agents page renders both seeded agents |
| `findings` | `flows/findings.json` | PR detail page shows findings after a review |
| `diff` | `flows/diff.json` | Diff view renders for the seeded PR |
| `onboarding` | `flows/onboarding.json` | Onboarding wizard loads and first step renders |
| `settings` | `flows/settings.json` | Settings page loads, provider selector visible |
| `azure-devops` | `specs/08-azure-devops.flow.json` | Settings API Keys renders the Azure DevOps PAT row alongside GitHub (TASK-010/TASK-011) |
| `agent-performance` | `specs/09-agent-performance.flow.json` | Agent Performance opens from the GLOBAL sidebar and renders seeded agents, an agent without runs, and both cost donuts (read-only, needs the performance demo seed) |
| `stats-period-shared` | `specs/10-stats-period-shared.flow.json` | The 1 day / 30 days period set on Agent Performance carries over to the agent's Stats tab and back |
| `skill-stats` | `specs/11-skill-stats.flow.json` | Skill Stats tab renders pull frequency, the agents list and findings by category |

## What Is Not Covered

| Scenario | Why not covered |
|----------|----------------|
| Actually running a review end-to-end | Requires LLM API keys — non-deterministic, not suitable for e2e |
| Creating a new repo via UI | Requires GitHub token + live repo — non-deterministic |
| Importing PRs | Requires GitHub API — non-deterministic |
| Error states (API down, bad key) | Would require killing the server mid-flow — complex setup |
| Mobile / responsive layout | agent-browser runs at desktop viewport only |
| A real Azure DevOps repo end-to-end (add repo → poll PRs → review → publish comment) | Requires a live ADO PAT + a real org/project/repo — non-deterministic, same reasoning as the GitHub "creating a new repo" / "importing PRs" rows above. Covered by mock-based unit tests of the ADO adapter (`server/src/adapters/azure-devops/*.test.ts`) and the hermetic `pulls-detail-ado-degraded.it.test.ts`. The former real-API `*.azure-devops.it.test.ts` suites were removed (2026-09-23): they read the owner's PAT and wrote threads into a real work PR on every pre-commit run. |

## Coverage Principles

E2E tests cover **rendering and navigation** — that the right data appears on the right page given the seeded state. They do not cover **business logic** — that is covered by server unit/integration tests and reviewer-core tests.

The goal is to catch: broken routes, missing components, failed API connections, and deployment regressions. Not to duplicate unit test assertions.

## Seed Dependency

All flows depend on the demo seed (`pnpm db:seed`):
- Repo: `acme/payments-api`
- PR: `#482`
- Agents: `General Reviewer` and `Security Reviewer`

If the seed changes, flow assertions that check for these values must be updated.

## Adding Coverage for a New Feature

When a new lesson adds a new page or significant UI feature:
1. Add a flow that verifies the page renders with seeded data
2. Do not add flows for features that require external API calls (LLM, GitHub)
3. Add the `data-testid` attributes to new components before writing the flow
