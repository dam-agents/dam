CREATE TABLE "attention_records" (
	"agent_id" text NOT NULL,
	"session_id" text NOT NULL,
	"owner_sub" text NOT NULL,
	"mode" text NOT NULL,
	"type" text NOT NULL,
	"title" text,
	"schedule_id" text,
	"experiment_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"activity_at" timestamp with time zone,
	"seen_at" timestamp with time zone,
	"working" boolean DEFAULT false NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_records_agent_id_session_id_pk" PRIMARY KEY("agent_id","session_id")
);
--> statement-breakpoint
CREATE TABLE "attention_state" (
	"user_sub" text NOT NULL,
	"item_kind" text NOT NULL,
	"item_id" text NOT NULL,
	"dismissed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attention_state_user_sub_item_kind_item_id_pk" PRIMARY KEY("user_sub","item_kind","item_id")
);
--> statement-breakpoint
CREATE INDEX "attention_records_owner_activity_idx" ON "attention_records" USING btree ("owner_sub","activity_at");--> statement-breakpoint
CREATE INDEX "attention_records_activity_idx" ON "attention_records" USING btree ("activity_at");--> statement-breakpoint
CREATE INDEX "attention_state_user_idx" ON "attention_state" USING btree ("user_sub");