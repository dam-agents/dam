CREATE TABLE "control"."agent_store_exports" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "control"."agent_store_exports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"exported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recipient" text NOT NULL,
	"plaintext_sha256" text NOT NULL,
	"ciphertext_sha256" text NOT NULL
);
