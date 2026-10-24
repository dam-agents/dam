-- Two things the api-server's Postgres adapters read and could not see, both
-- added as triggers so no writer can forget them.
--
-- A kit write was invisible: the table carries the starter-kit, onboarding and
-- seed bookkeeping that the api-server rebuilds as annotations, and it published
-- nothing on the change feed, so a cache on another replica kept serving the old
-- kit state until a relist.
CREATE TRIGGER agent_kit_state_notify
  AFTER INSERT OR UPDATE OR DELETE ON control.agent_kit_state
  FOR EACH ROW EXECUTE FUNCTION control.notify_agent_change();
--> statement-breakpoint

-- A condition write did not advance the status version, and the version is what
-- an api-server decision compares before it writes: an image update decides to
-- roll back from conditions (`StartFailed`, the ready transition) and names the
-- status version it read. A condition that changed after that read left the
-- version alone, so the rollback landed on state it had not been decided from.
-- The controller writes conditions and status together, in one transaction.
--
-- The row update is the point, as it is in `agents_guard`: a no-op assignment
-- lets the status bump trigger add one. The lock order is that trigger's —
-- conditions, then status — and the controller already holds a shared lock on
-- the signals row.
CREATE FUNCTION control.bump_status_on_condition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE control.agent_status SET version = version WHERE agent_id = OLD.agent_id;
    RETURN OLD;
  END IF;
  UPDATE control.agent_status SET version = version WHERE agent_id = NEW.agent_id;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER agent_conditions_bump_status
  AFTER INSERT OR UPDATE OR DELETE ON control.agent_conditions
  FOR EACH ROW EXECUTE FUNCTION control.bump_status_on_condition();
