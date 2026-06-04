CREATE TABLE "terms_acceptances" (
	"sub" text NOT NULL,
	"version" text NOT NULL,
	"hash" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terms_acceptances_sub_version_pk" PRIMARY KEY("sub","version")
);
