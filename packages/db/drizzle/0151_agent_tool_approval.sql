-- An agent holds one tool approval (ask, auto or bypass) that every session
-- of it runs on unless the session picked its own. It is a column of its own,
-- not part of a session pair, so no profile, channel or schedule carries one.
-- Null keeps each harness on its own start, as before the column existed.
ALTER TABLE "agents" ADD COLUMN "tool_approval" text;
