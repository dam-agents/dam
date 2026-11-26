CREATE TABLE "owner_request_card_items" (
	"card_id" text NOT NULL,
	"request_kind" text NOT NULL,
	"request_id" text NOT NULL,
	"host" text,
	"state" text DEFAULT 'waiting' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_request_card_items_card_id_request_id_pk" PRIMARY KEY("card_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "owner_request_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_sub" text NOT NULL,
	"agent_id" text NOT NULL,
	"team_id" text NOT NULL,
	"kind" text NOT NULL,
	"dm_channel" text,
	"message_ts" text,
	"posted_at" timestamp with time zone,
	"threads" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_change" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_request_dismissals" (
	"owner_sub" text NOT NULL,
	"agent_id" text NOT NULL,
	"host" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	CONSTRAINT "owner_request_dismissals_owner_sub_agent_id_host_pk" PRIMARY KEY("owner_sub","agent_id","host")
);
--> statement-breakpoint
ALTER TABLE "owner_request_card_items" ADD CONSTRAINT "owner_request_card_items_card_id_owner_request_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."owner_request_cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_request_card_items_request_idx" ON "owner_request_card_items" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "owner_request_cards_open_idx" ON "owner_request_cards" USING btree ("owner_sub","agent_id","team_id","kind") WHERE closed_at IS NULL AND kind IN ('turn', 'background');--> statement-breakpoint
CREATE INDEX "owner_request_cards_owner_idx" ON "owner_request_cards" USING btree ("owner_sub","closed_at");