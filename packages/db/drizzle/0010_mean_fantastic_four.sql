-- #2314: egress rules can name a non-443 upstream port. NULL = 443.
ALTER TABLE "egress_rules" ADD COLUMN "port" integer;