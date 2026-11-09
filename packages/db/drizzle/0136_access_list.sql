-- The install's access list: the email addresses Keycloak lets sign in when
-- the list is on, so the list lives in the platform instead of a file Keycloak
-- fetches from an outside Git host. Operators change it in Settings; a row the
-- chart's seed added has no added_by.
CREATE TABLE "access_list" (
	"email" text PRIMARY KEY NOT NULL,
	"added_by" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
