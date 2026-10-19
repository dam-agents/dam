-- A Telegram binding covers its whole chat: a forum topic resolves to its
-- chat's binding, and a reply in a supergroup no longer carries a thread id of
-- its own. A row stored for one topic or one reply chain
-- (`telegram:<chat>:<thread>`) folds into its chat (`telegram:<chat>`), so no
-- row stays listed as connected while nothing can reach it. A chat that has
-- its own row keeps it and drops the others; otherwise its oldest row becomes
-- the chat's binding and the rest go. Business ids (`telegram:biz:…`) have no
-- thread and are left alone.
WITH "ranked" AS (
  SELECT
    "conversation_id",
    row_number() OVER (
      PARTITION BY split_part("conversation_id", ':', 2)
      ORDER BY ("conversation_id" ~ '^telegram:-?[0-9]+$') DESC, "created_at", "conversation_id"
    ) AS "rank"
  FROM "telegram_conversations"
  WHERE "conversation_id" ~ '^telegram:-?[0-9]+(:[0-9]+)?$'
)
DELETE FROM "telegram_conversations" AS "t"
USING "ranked" AS "r"
WHERE "t"."conversation_id" = "r"."conversation_id" AND "r"."rank" > 1;
--> statement-breakpoint
UPDATE "telegram_conversations"
SET "conversation_id" = regexp_replace("conversation_id", ':[0-9]+$', '')
WHERE "conversation_id" ~ '^telegram:-?[0-9]+:[0-9]+$';
