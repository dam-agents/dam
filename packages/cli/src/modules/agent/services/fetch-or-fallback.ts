import type { AgentView } from "../domain/agent-view.js";
import type { AgentService } from "./agent-service.js";

/**
 * Fetch the latest Agent state; on failure, warn to stderr and return the
 * caller-supplied snapshot so scripted callers always get a valid Agent
 * JSON, never empty stdout.
 *
 * Used by the post-action JSON branches of `create --wait --json` and
 * `restart [--wait] --json`: the server-side mutation already succeeded
 * (or, for create's timeout case, the Agent was created and just didn't
 * reach `running` in time) — a refresh failure is a JSON-staleness
 * concern, not a command-level failure. The fallback is the snapshot the
 * caller already has in hand: the result of `agents.create` for create,
 * or the pre-restart Agent for restart.
 *
 * `context` is a short human-readable phrase ("after restart", "after
 * wait timeout") inserted into the warning so the user can tell which
 * verb produced the stale-state warning.
 */
export async function fetchOrFallback(
  svc: AgentService,
  fallback: AgentView,
  context: string,
): Promise<AgentView> {
  const refreshed = await svc.get(fallback.id);
  if (refreshed.ok && refreshed.value !== null) return refreshed.value;
  process.stderr.write(
    `warning: could not refresh agent "${fallback.name}" ${context}; emitting last-known state\n`,
  );
  return fallback;
}
