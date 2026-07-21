ALTER TABLE "ci_installations" ADD COLUMN "last_synced_etag" text;--> statement-breakpoint
ALTER TABLE "ci_installations" ADD COLUMN "last_synced_at" timestamp with time zone;