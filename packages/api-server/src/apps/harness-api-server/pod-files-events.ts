import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { PodFilesBus } from "../../modules/pod-files/bus.js";
import type { FileSpec } from "../../modules/pod-files/types.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { resolveInstanceIdentity } from "./instance-auth.js";

export interface PodFilesEventsDeps {
  k8s: K8sClient;
  bus: PodFilesBus;
  /** Returns the file specs to materialize for the agent's current state. */
  fetchSnapshot: (owner: string, agentId: string) => Promise<FileSpec[]>;
}

/**
 * Mount the SSE channel the agent-runtime holds open to receive pod-file
 * upserts. ADR-039: caller identity is enforced upstream by an Istio
 * AuthorizationPolicy on the harness Service that admits only the
 * principal whose SA name equals the URL `:id`. Topics are keyed by agent
 * ID since connection grants are agent-scoped (every instance of the
 * same agent sees the same grants).
 */
export function mountPodFilesEventsRoute(app: Hono, deps: PodFilesEventsDeps) {
  app.get("/api/instances/:id/pod-files/events", async (c) => {
    const instanceId = c.req.param("id")!;
    const identity = await resolveInstanceIdentity(deps.k8s, instanceId);
    if (!identity) return c.json({ error: "not found" }, 404);

    const { agentId, owner } = identity;
    return streamSSE(c, async (stream) => {
      // Subscribe before the snapshot fetch so we don't miss an upsert that
      // races with it.
      const queue: FileSpec[][] = [];
      let resolveWaiter: (() => void) | null = null;
      const wakeWaiter = () => {
        const r = resolveWaiter;
        resolveWaiter = null;
        r?.();
      };
      const unsubscribe = deps.bus.subscribe(agentId, (e) => {
        queue.push(e.files);
        wakeWaiter();
      });
      // Hono flips stream.aborted on disconnect but won't wake an already-
      // parked Promise — without onAbort the loop below would leak the
      // subscriber and a parked async frame on every reconnect.
      stream.onAbort(wakeWaiter);

      try {
        const snapshot = await deps.fetchSnapshot(owner, agentId).catch((err) => {
          console.warn(`pod-files snapshot for owner=${owner} agent=${agentId} failed:`, err);
          return [] as FileSpec[];
        });
        await stream.writeSSE({
          event: "snapshot",
          data: JSON.stringify({ files: snapshot }),
        });

        while (!stream.aborted) {
          while (queue.length > 0 && !stream.aborted) {
            const files = queue.shift()!;
            await stream.writeSSE({
              event: "upsert",
              data: JSON.stringify({ files }),
            });
          }
          if (stream.aborted) break;
          await new Promise<void>((resolve) => {
            resolveWaiter = resolve;
          });
        }
      } finally {
        unsubscribe();
      }
    });
  });
}
