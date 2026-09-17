DROP INDEX "repos_ws_fullname_uq";--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "vcs_provider" text DEFAULT 'github' NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "project" text;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "base_url" text;--> statement-breakpoint
CREATE UNIQUE INDEX "repos_ws_provider_fullname_uq" ON "repos" USING btree ("workspace_id","vcs_provider","full_name");--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_vcs_provider_check" CHECK ("repos"."vcs_provider" IN ('github', 'azure-devops'));