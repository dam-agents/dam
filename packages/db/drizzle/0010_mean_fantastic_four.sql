-- External cluster connectivity (#2314): egress rules can name a non-443
-- upstream port (e.g. a Kubernetes API server on 6443). Nullable — NULL
-- means 443; outside the lookup key, recorded for transparency surfaces.
ALTER TABLE "egress_rules" ADD COLUMN "port" integer;