import type { Instance } from "api-server-api";
import type { InstanceService } from "./instance-service.js";

/**
 * Fetch the latest Instance state; on failure, warn to stderr and
 * return the caller-supplied snapshot so scripted callers always get a
 * valid Instance JSON, never empty stdout.
 *
 * Used by the post-action JSON branches of `create --wait --json` and
 * `restart [--wait] --json`: the server-side mutation already succeeded
 * (or, for create's timeout case, the Instance was created and just
 * didn't reach `running` in time) — a refresh failure is a
 * JSON-staleness concern, not a command-level failure. The fallback is
 * the snapshot the caller already has in hand: the result of
 * `instances.create` for create, or the pre-restart Instance for
 * restart.
 *
 * `context` is a short human-readable phrase ("after restart", "after
 * wait timeout") inserted into the warning so the user can tell which
 * verb produced the stale-state warning.
 */
export async function fetchOrFallback(
  svc: InstanceService,
  fallback: Instance,
  context: string,
): Promise<Instance> {
  const refreshed = await svc.get(fallback.id);
  if (refreshed.ok && refreshed.value !== null) return refreshed.value;
  process.stderr.write(
    `warning: could not refresh instance "${fallback.name}" ${context}; emitting last-known state\n`,
  );
  return fallback;
}
