-- UI usage telemetry: what the web UI reports about how people use it (views,
-- clicks on elements with a test id, friction signals, journey steps). Its own
-- table rather than activity_events: the volume is much higher and rows keep
-- only 30 days. actor_sub is pseudonymized like every other actor column.
CREATE TABLE "ui_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "ui_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_sub" text NOT NULL,
	"tab" text NOT NULL,
	"build" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"route" text NOT NULL,
	"element" text,
	"signal" text,
	"flow" text,
	"step" text,
	"duration_ms" integer,
	"occurred_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ui_events_occurred_idx" ON "ui_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "ui_events_tab_seq_idx" ON "ui_events" USING btree ("tab","seq");