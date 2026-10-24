-- The `control` schema: the tables Agents and user budgets become, replacing
-- the two custom resources as the authority (docs/architecture/persistence.md).
-- Empty on this release — the definitions migrate when the authority switches,
-- so nothing here has a reader yet.
--
-- The schema, not a rename of `public.agents`, because the usage mirror keeps
-- its name and its readers, and because a separate schema is where the
-- controller's grants can be confined to.
-- The split is by writer: definitions, signals and budgets the api-server
-- writes; observations the controller writes; one shared row whose
-- controller-owned columns are granted as a list.
-- Constraints are only as strict as the custom resource's admission rules, so
-- no stored resource can fail to become a row.
CREATE SCHEMA "control";
--> statement-breakpoint
CREATE TABLE "control"."agent_conditions" (
	"agent_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"reason" text NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"observed_generation" bigint NOT NULL,
	"last_transition_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_conditions_agent_id_type_pk" PRIMARY KEY("agent_id","type"),
	CONSTRAINT "control_agent_conditions_status" CHECK ("control"."agent_conditions"."status" IN ('True', 'False', 'Unknown')),
	CONSTRAINT "control_agent_conditions_reason" CHECK ("control"."agent_conditions"."reason" ~ '^[A-Za-z]([A-Za-z0-9_,:]*[A-Za-z0-9_])?$' AND length("control"."agent_conditions"."reason") <= 1024),
	CONSTRAINT "control_agent_conditions_message" CHECK (length("control"."agent_conditions"."message") <= 32768)
);
--> statement-breakpoint
CREATE TABLE "control"."agent_kit_state" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"starter_kit" text,
	"onboarded_at" timestamp with time zone,
	"seed_url" text,
	"seed_branch" text,
	"seed_commit" text,
	"default_model" text,
	"pending_commit" text,
	"pending_started_at" timestamp with time zone,
	"skipped_commit" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "control_agent_kit_state_seed_commit" CHECK ("control"."agent_kit_state"."seed_commit" IS NULL OR "control"."agent_kit_state"."seed_commit" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "control_agent_kit_state_pending_commit" CHECK ("control"."agent_kit_state"."pending_commit" IS NULL OR "control"."agent_kit_state"."pending_commit" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "control_agent_kit_state_skipped_commit" CHECK ("control"."agent_kit_state"."skipped_commit" IS NULL OR "control"."agent_kit_state"."skipped_commit" ~ '^[0-9a-f]{40}$'),
	CONSTRAINT "control_agent_kit_state_seed_pair" CHECK (("control"."agent_kit_state"."seed_url" IS NULL) = ("control"."agent_kit_state"."seed_commit" IS NULL)),
	CONSTRAINT "control_agent_kit_state_pending_pair" CHECK (("control"."agent_kit_state"."pending_commit" IS NULL) = ("control"."agent_kit_state"."pending_started_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "control"."agent_l7_hosts" (
	"agent_id" text NOT NULL,
	"host" text NOT NULL,
	CONSTRAINT "agent_l7_hosts_agent_id_host_pk" PRIMARY KEY("agent_id","host"),
	CONSTRAINT "control_agent_l7_hosts_host" CHECK ("control"."agent_l7_hosts"."host" ~ '^(\*\.)?([a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([-a-zA-Z0-9]{0,61}[a-zA-Z0-9])?)*$' AND length("control"."agent_l7_hosts"."host") <= 253)
);
--> statement-breakpoint
CREATE TABLE "control"."agent_signals" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone,
	"last_activity_token" uuid,
	"session_pinned" boolean DEFAULT false NOT NULL,
	"invocation_pinned" boolean DEFAULT false NOT NULL,
	"invocation_pin_version" bigint DEFAULT 0 NOT NULL,
	"stop_request_token" text,
	"stop_requested_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"roll_rev" text DEFAULT '' NOT NULL,
	"reclaimed_at" timestamp with time zone,
	"reclaimed_activity_token" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control"."agent_status" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"observed_generation" bigint DEFAULT 0 NOT NULL,
	"observed_signal_version" bigint DEFAULT 0 NOT NULL,
	"machine_restarts" integer DEFAULT 0 NOT NULL,
	"machine_restart_reason" text,
	"machine_up_at" timestamp with time zone,
	"machine_down_at" timestamp with time zone,
	"memory_wait_until" timestamp with time zone,
	"runner_oom_kill_id" text,
	"runner_oom_recovered_id" text,
	"version" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "control"."agent_store" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"schema_generation" integer DEFAULT 1 NOT NULL,
	"absorbed_at" timestamp with time zone,
	"anchors_ensured_at" timestamp with time zone,
	"switch_completed_at" timestamp with time zone,
	"controller_holder" text,
	"backup_ref" text,
	"absorb_report" jsonb,
	CONSTRAINT "control_agent_store_single_row" CHECK ("control"."agent_store"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "control"."agents" (
	"id" text PRIMARY KEY NOT NULL,
	"incarnation" uuid DEFAULT gen_random_uuid() NOT NULL,
	"owner_sub" text NOT NULL,
	"template_id" text,
	"environment_of" text,
	"name" text DEFAULT '' NOT NULL,
	"description" text,
	"avatar" text,
	"whispers_off" boolean DEFAULT false NOT NULL,
	"image" text NOT NULL,
	"harness" text,
	"image_pull_secret_ref" text,
	"secret_ref" text,
	"hibernation_timeout_ns" bigint,
	"nested_virtualization" boolean DEFAULT false NOT NULL,
	"require_connection_address" boolean DEFAULT false NOT NULL,
	"telemetry_attribution_id" text,
	"cpu_limit" text NOT NULL,
	"memory_limit" text NOT NULL,
	"disk_size" text,
	"memory_fallback_bytes" bigint,
	"disk_floor_bytes" bigint,
	"unsupported_persistent_paths" text[] DEFAULT '{}' NOT NULL,
	"sweepable" boolean DEFAULT false NOT NULL,
	"lifetime_ms" bigint,
	"kind" text,
	"kb_template_id" text,
	"kb_share_roots" text[],
	"image_update_from" text,
	"image_update_refused" text,
	"generation" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "control_agents_id_dns_label" CHECK ("control"."agents"."id" ~ '^[a-z0-9]([-a-z0-9]*[a-z0-9])?$' AND length("control"."agents"."id") <= 63),
	CONSTRAINT "control_agents_owner_sub_present" CHECK (length("control"."agents"."owner_sub") > 0),
	CONSTRAINT "control_agents_image_present" CHECK (length("control"."agents"."image") > 0),
	CONSTRAINT "control_agents_cpu_limit_quantity" CHECK ("control"."agents"."cpu_limit" ~ '^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))))?$'),
	CONSTRAINT "control_agents_memory_limit_quantity" CHECK ("control"."agents"."memory_limit" ~ '^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))))?$'),
	CONSTRAINT "control_agents_disk_size_quantity" CHECK ("control"."agents"."disk_size" IS NULL OR "control"."agents"."disk_size" ~ '^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))))?$'),
	CONSTRAINT "control_agents_hibernation_timeout_ns" CHECK ("control"."agents"."hibernation_timeout_ns" IS NULL OR "control"."agents"."hibernation_timeout_ns" >= 0),
	CONSTRAINT "control_agents_lifetime_ms" CHECK ("control"."agents"."lifetime_ms" IS NULL OR "control"."agents"."lifetime_ms" >= 0),
	CONSTRAINT "control_agents_memory_fallback_bytes" CHECK ("control"."agents"."memory_fallback_bytes" IS NULL OR "control"."agents"."memory_fallback_bytes" > 0),
	CONSTRAINT "control_agents_disk_floor_bytes" CHECK ("control"."agents"."disk_floor_bytes" IS NULL OR "control"."agents"."disk_floor_bytes" > 0),
	CONSTRAINT "control_agents_generation_positive" CHECK ("control"."agents"."generation" > 0)
);
--> statement-breakpoint
CREATE TABLE "control"."crd_snapshots" (
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"uid" uuid,
	"sha256" text NOT NULL,
	"yaml" text NOT NULL,
	CONSTRAINT "crd_snapshots_captured_at_kind_name_pk" PRIMARY KEY("captured_at","kind","name")
);
--> statement-breakpoint
CREATE TABLE "control"."user_budgets" (
	"owner_sub" text PRIMARY KEY NOT NULL,
	"cpu" text,
	"memory" text,
	"storage" text,
	"set_by_sub" text,
	"operator_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "control_user_budgets_owner_sub" CHECK (length("control"."user_budgets"."owner_sub") BETWEEN 1 AND 246),
	CONSTRAINT "control_user_budgets_cpu_quantity" CHECK ("control"."user_budgets"."cpu" IS NULL OR "control"."user_budgets"."cpu" ~ '^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))))?$'),
	CONSTRAINT "control_user_budgets_memory_quantity" CHECK ("control"."user_budgets"."memory" IS NULL OR "control"."user_budgets"."memory" ~ '^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))))?$'),
	CONSTRAINT "control_user_budgets_storage_quantity" CHECK ("control"."user_budgets"."storage" IS NULL OR "control"."user_budgets"."storage" ~ '^(\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[numkMGTPE]|([eE](\+|-)?(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))))?$'),
	CONSTRAINT "control_user_budgets_has_override" CHECK (num_nonnulls("control"."user_budgets"."cpu", "control"."user_budgets"."memory", "control"."user_budgets"."storage") >= 1)
);
--> statement-breakpoint
ALTER TABLE "control"."agent_conditions" ADD CONSTRAINT "agent_conditions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "control"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."agent_kit_state" ADD CONSTRAINT "agent_kit_state_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "control"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."agent_l7_hosts" ADD CONSTRAINT "agent_l7_hosts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "control"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."agent_signals" ADD CONSTRAINT "agent_signals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "control"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "control"."agent_status" ADD CONSTRAINT "agent_status_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "control"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "control_agent_signals_session_pinned_idx" ON "control"."agent_signals" USING btree ("agent_id") WHERE "control"."agent_signals"."session_pinned";--> statement-breakpoint
CREATE INDEX "control_agent_signals_invocation_pinned_idx" ON "control"."agent_signals" USING btree ("agent_id") WHERE "control"."agent_signals"."invocation_pinned";--> statement-breakpoint
CREATE INDEX "control_agent_signals_disabled_idx" ON "control"."agent_signals" USING btree ("agent_id") WHERE "control"."agent_signals"."disabled_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "control_agents_incarnation_idx" ON "control"."agents" USING btree ("incarnation");--> statement-breakpoint
CREATE INDEX "control_agents_owner_idx" ON "control"."agents" USING btree ("owner_sub","created_at","id");--> statement-breakpoint
CREATE INDEX "control_agents_environment_of_idx" ON "control"."agents" USING btree ("environment_of") WHERE "control"."agents"."environment_of" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "control_agents_updated_at_idx" ON "control"."agents" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "control_user_budgets_updated_at_idx" ON "control"."user_budgets" USING btree ("updated_at","owner_sub");