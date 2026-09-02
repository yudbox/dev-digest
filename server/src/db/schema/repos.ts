import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { now } from './_shared';
import { workspaces, users } from './core';

export const repos = pgTable(
  'repos',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /**
     * Discriminator for the `VcsClient` implementation this row dispatches
     * to. TEXT + CHECK (not a Postgres enum) so a future third provider
     * doesn't require an `ALTER TYPE` — see `vendor/shared/contracts/platform.ts`'s
     * `VcsProvider` for the canonical value set this must stay in sync with.
     */
    vcsProvider: text('vcs_provider').notNull().default('github'),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    /** Azure DevOps only: middle segment of org/project/repo. Null for GitHub. */
    project: text('project'),
    /** Azure DevOps only: hosting base URL. Null for GitHub. */
    baseUrl: text('base_url'),
    fullName: text('full_name').notNull(),
    defaultBranch: text('default_branch').notNull().default('main'),
    clonePath: text('clone_path'),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: now(),
  },
  (t) => ({
    // Uniqueness now includes vcsProvider so github:acme/api and
    // ado:acme/api can coexist in the same workspace without conflict.
    uq: uniqueIndex('repos_ws_provider_fullname_uq').on(t.workspaceId, t.vcsProvider, t.fullName),
    wsIdx: index('repos_ws_idx').on(t.workspaceId),
    vcsProviderCheck: check(
      'repos_vcs_provider_check',
      sql`${t.vcsProvider} IN ('github', 'azure-devops')`,
    ),
  }),
);
