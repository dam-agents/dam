-- The measuring start: the moment from which the gateway meter measures spend
-- on this deployment. Spend before it is not in spend_daily, so every spend
-- screen says since when it measures. The table keeps one row, which never
-- changes after the next migration sets it.
CREATE TABLE "spend_metering" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "spend_metering_single_row" CHECK ("spend_metering"."id" = 1)
);
