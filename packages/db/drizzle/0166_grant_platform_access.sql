-- Platform Access: what one Agent may do on the platform when it calls with
-- its own Agent Key, kept on its grant of the platform Connection. No backfill:
-- a grant with no value keeps today's behaviour, its Agent acts with the
-- Connection's own key, as its owner. The api-server reads the column on every
-- request such an Agent makes, so a write needs no new render of the gateway
-- and the trigger connection_grants_bump_generation is left as it is.
ALTER TABLE "connection_grants" ADD COLUMN "platform_access" jsonb;