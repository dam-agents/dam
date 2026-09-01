DELETE FROM "connection_grants" g
WHERE NOT EXISTS (
  SELECT 1 FROM "connections" c WHERE c."id" = g."connection_id"
);
