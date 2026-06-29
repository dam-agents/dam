-- #1900: per-user override of the concurrent CPU/memory ceiling; users without a row get the Helm defaults.
CREATE TABLE "user_budgets" (
	"owner" text PRIMARY KEY NOT NULL,
	"cpu_milli" bigint NOT NULL,
	"memory_bytes" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
