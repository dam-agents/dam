CREATE TABLE "spend_ceilings" (
	"owner_sub" text PRIMARY KEY NOT NULL,
	"amount_micros" bigint NOT NULL,
	"set_by_sub" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
