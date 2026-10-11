CREATE TABLE "agent_run_memory" (
	"run_id" uuid NOT NULL,
	"memory_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"similarity" double precision,
	CONSTRAINT "agent_run_memory_run_id_memory_id_pk" PRIMARY KEY("run_id","memory_id")
);
--> statement-breakpoint
CREATE TABLE "agent_run_skills" (
	"run_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"skill_version" integer NOT NULL,
	"applied" boolean NOT NULL,
	"findings_cited" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_run_skills_run_id_skill_id_pk" PRIMARY KEY("run_id","skill_id")
);
--> statement-breakpoint
ALTER TABLE "findings" ADD COLUMN "rule_refs" uuid[];--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "cost_source" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "memory_mode" text;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "ci_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_run_memory" ADD CONSTRAINT "agent_run_memory_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_memory" ADD CONSTRAINT "agent_run_memory_memory_id_memory_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memory"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_skills" ADD CONSTRAINT "agent_run_skills_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run_skills" ADD CONSTRAINT "agent_run_skills_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_ci_run_id_ci_runs_id_fk" FOREIGN KEY ("ci_run_id") REFERENCES "public"."ci_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reviews_run_id_idx" ON "reviews" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_ws_ran_at_idx" ON "agent_runs" USING btree ("workspace_id","ran_at");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_ran_at_idx" ON "agent_runs" USING btree ("agent_id","ran_at");