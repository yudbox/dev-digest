CREATE TABLE "memory_learning_state" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"last_processed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory" ADD COLUMN "source" text DEFAULT 'explicit' NOT NULL;--> statement-breakpoint
ALTER TABLE "memory_learning_state" ADD CONSTRAINT "memory_learning_state_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;