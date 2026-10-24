-- The behaviour the control tables need that Drizzle's schema DSL cannot
-- express: the guards that keep a definition immutable and versioned, the
-- change feed the controller listens on, and the projection through which the
-- controller sees connection grants without reading the connection itself.
--
-- All of it is additive — the tables it guards are created in the previous
-- migration, and the custom resources stay authoritative until the switch.

-- A definition's identity never changes: the owner shards the controller's
-- queues, the incarnation is what tells this Agent from a later one under the
-- same name, and an Environment link is set at create. The custom resource
-- enforced the last two at admission; the owner label was immutable only
-- because no code path rewrote it.
--
-- The generation advances on exactly the columns the controller renders, so
-- `observedGeneration` keeps its present meaning. Display fields, kit
-- bookkeeping and image-update bookkeeping deliberately do not bump it: a
-- rename no longer looks like a spec change and no longer resets the start
-- conditions.
--
-- Eligibility only lives in `hibernation_timeout_ns` and `sweepable`, and a
-- decision about whether to hibernate an Agent reads both. Bumping the signals
-- row here is what makes the controller's reclaim compare-and-set catch a
-- timeout raised at the same instant: the row update is the point, so the
-- assignment is a no-op that lets the version trigger below add one.
--
-- A guard that takes two locks fixes their order: every writer that touches
-- both a definition and its signals row must write the definition first.
-- Ordinary inserts and updates by the two services do not, and a writer that
-- does will deadlock against this trigger until it follows the order.
CREATE FUNCTION control.agents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'control.agents.id is immutable (agent %)', OLD.id;
  END IF;
  IF NEW.owner_sub IS DISTINCT FROM OLD.owner_sub THEN
    RAISE EXCEPTION 'control.agents.owner_sub is immutable (agent %)', OLD.id;
  END IF;
  IF NEW.incarnation IS DISTINCT FROM OLD.incarnation THEN
    RAISE EXCEPTION 'control.agents.incarnation is immutable (agent %)', OLD.id;
  END IF;
  IF NEW.environment_of IS DISTINCT FROM OLD.environment_of THEN
    RAISE EXCEPTION 'control.agents.environment_of is immutable (agent %)', OLD.id;
  END IF;

  IF (NEW.image, NEW.harness, NEW.image_pull_secret_ref, NEW.secret_ref,
      NEW.hibernation_timeout_ns, NEW.nested_virtualization,
      NEW.require_connection_address, NEW.telemetry_attribution_id,
      NEW.cpu_limit, NEW.memory_limit, NEW.disk_size, NEW.sweepable)
     IS DISTINCT FROM
     (OLD.image, OLD.harness, OLD.image_pull_secret_ref, OLD.secret_ref,
      OLD.hibernation_timeout_ns, OLD.nested_virtualization,
      OLD.require_connection_address, OLD.telemetry_attribution_id,
      OLD.cpu_limit, OLD.memory_limit, OLD.disk_size, OLD.sweepable)
  THEN
    NEW.generation := OLD.generation + 1;
  END IF;

  IF NEW.hibernation_timeout_ns IS DISTINCT FROM OLD.hibernation_timeout_ns
     OR NEW.sweepable IS DISTINCT FROM OLD.sweepable
  THEN
    UPDATE control.agent_signals SET version = version WHERE agent_id = NEW.id;
  END IF;

  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER agents_guard BEFORE UPDATE ON control.agents
  FOR EACH ROW EXECUTE FUNCTION control.agents_guard();
--> statement-breakpoint

-- Every write to a versioned row rotates its token, so a compare-and-set never
-- needs the whole row: the signals version guards activity, pins and stop
-- requests as one, and the status version guards the controller's own
-- concurrent paths (idle check, readiness, OOM attribution).
CREATE FUNCTION control.bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER agent_signals_bump_version BEFORE UPDATE ON control.agent_signals
  FOR EACH ROW EXECUTE FUNCTION control.bump_version();
--> statement-breakpoint

CREATE TRIGGER agent_status_bump_version BEFORE UPDATE ON control.agent_status
  FOR EACH ROW EXECUTE FUNCTION control.bump_version();
--> statement-breakpoint

CREATE TRIGGER agent_kit_state_bump_version BEFORE UPDATE ON control.agent_kit_state
  FOR EACH ROW EXECUTE FUNCTION control.bump_version();
--> statement-breakpoint

-- Host lists and connection grants were spec fields until the move, so a change
-- to either still has to advance the definition's generation: that is what
-- re-renders the Agent's gateway. Only a change to the set does — a grant's
-- `preferred` flag and `granted_at` are bookkeeping the gateway never sees, so
-- the trigger names the two columns whose value is the membership.
--
-- One row at a time: inserting an Agent with its hosts leaves the generation
-- above what the Agent's own writes set, so an importer that must preserve the
-- source generation sets it after the children are in.
CREATE FUNCTION control.bump_agents_generation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE control.agents SET generation = generation + 1 WHERE id = OLD.agent_id;
    RETURN OLD;
  END IF;
  UPDATE control.agents SET generation = generation + 1 WHERE id = NEW.agent_id;
  IF TG_OP = 'UPDATE' AND NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    UPDATE control.agents SET generation = generation + 1 WHERE id = OLD.agent_id;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER agent_l7_hosts_bump_generation
  AFTER INSERT OR UPDATE OR DELETE ON control.agent_l7_hosts
  FOR EACH ROW EXECUTE FUNCTION control.bump_agents_generation();
--> statement-breakpoint

CREATE TRIGGER connection_grants_bump_generation
  AFTER INSERT OR DELETE OR UPDATE OF connection_id, agent_id ON public.connection_grants
  FOR EACH ROW EXECUTE FUNCTION control.bump_agents_generation();
--> statement-breakpoint

-- The custom resource's admission caps an Agent at 256 L7 hosts, because each
-- one is a name on the gateway's leaf certificate. A row constraint cannot
-- count siblings, and a statement trigger would miss two statements that each
-- stay under the cap, so the cap is a deferred constraint trigger: it counts at
-- commit, where a set written in one transaction is complete.
CREATE FUNCTION control.agent_l7_hosts_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  total integer;
BEGIN
  SELECT count(*) INTO total FROM control.agent_l7_hosts WHERE agent_id = NEW.agent_id;
  IF total > 256 THEN
    RAISE EXCEPTION 'an Agent may carry at most 256 L7 hosts (agent % has %)', NEW.agent_id, total;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint

CREATE CONSTRAINT TRIGGER agent_l7_hosts_cap
  AFTER INSERT OR UPDATE ON control.agent_l7_hosts
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION control.agent_l7_hosts_cap();
--> statement-breakpoint

-- The change feed the controller listens on: one channel, a payload naming the
-- table that changed and the Agent it changed for. A subscriber refetches the
-- row; the payload is a wake-up, not a source.
--
-- Nothing else goes in it. Every login that can connect to this database can
-- LISTEN on this channel, and a channel has no grants, so the payload must leak
-- no more than a grant could: the owner's subject is left out, because the
-- usage mirror beside this schema deliberately carries it hashed (see the
-- usage source passthrough views) and a plaintext subject on a channel would
-- undo that. A budget's row is keyed by that subject, so its notification names
-- no record at all and means "re-read the budgets" — they are small and few.
--
-- `hot` marks the notifications that only carry a browser live-event hint —
-- an activity bump and nothing else. It filters refetch noise in the UI; the
-- controller treats every notification on this channel as urgent, because a
-- wake is exactly an activity bump and must not queue behind a drift sweep.
CREATE FUNCTION control.notify_agent_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  row_data jsonb;
  agent_id text;
  payload jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
  ELSE
    row_data := to_jsonb(NEW);
  END IF;

  IF TG_TABLE_NAME = 'user_budgets' THEN
    payload := jsonb_build_object('t', TG_TABLE_NAME, 'op', left(TG_OP, 1));
  ELSE
    agent_id := COALESCE(row_data->>'agent_id', row_data->>'id');
    payload := jsonb_build_object('t', TG_TABLE_NAME, 'op', left(TG_OP, 1), 'id', agent_id);
  END IF;

  IF TG_TABLE_NAME = 'agent_signals' AND TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'last_activity_at' - 'last_activity_token' - 'version' - 'updated_at')
       IS NOT DISTINCT FROM
       (to_jsonb(OLD) - 'last_activity_at' - 'last_activity_token' - 'version' - 'updated_at')
    THEN
      payload := payload || jsonb_build_object('hot', true);
    END IF;
  END IF;

  PERFORM pg_notify('agent_changes', payload::text);
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint

CREATE TRIGGER agents_notify AFTER INSERT OR UPDATE OR DELETE ON control.agents
  FOR EACH ROW EXECUTE FUNCTION control.notify_agent_change();
--> statement-breakpoint

CREATE TRIGGER agent_signals_notify AFTER INSERT OR UPDATE OR DELETE ON control.agent_signals
  FOR EACH ROW EXECUTE FUNCTION control.notify_agent_change();
--> statement-breakpoint

CREATE TRIGGER agent_status_notify AFTER INSERT OR UPDATE OR DELETE ON control.agent_status
  FOR EACH ROW EXECUTE FUNCTION control.notify_agent_change();
--> statement-breakpoint

CREATE TRIGGER agent_conditions_notify AFTER INSERT OR UPDATE OR DELETE ON control.agent_conditions
  FOR EACH ROW EXECUTE FUNCTION control.notify_agent_change();
--> statement-breakpoint

CREATE TRIGGER agent_l7_hosts_notify AFTER INSERT OR UPDATE OR DELETE ON control.agent_l7_hosts
  FOR EACH ROW EXECUTE FUNCTION control.notify_agent_change();
--> statement-breakpoint

CREATE TRIGGER user_budgets_notify AFTER INSERT OR UPDATE OR DELETE ON control.user_budgets
  FOR EACH ROW EXECUTE FUNCTION control.notify_agent_change();
--> statement-breakpoint

-- The controller's whole view of egress authority: which connections an Agent
-- may use, and nothing about them. The connection itself carries credential
-- material and owner-supplied inputs, which the controller has no business
-- reading.
CREATE VIEW control.agent_connection_grants AS
  SELECT agent_id, connection_id FROM public.connection_grants;
