import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { PodFilesBus } from "../../modules/pod-files/bus.js";
import type { FileSpec } from "../../modules/pod-files/types.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import { resolveInstance } from "./instance-auth.js";

export interface PodFilesEventsDeps {
  k8s: K8sClient;
  bus: PodFilesBus;
  /** Returns the file specs to materialize for the agent's current state. */
  fetchSnapshot: (owner: string, agentId: string) => Promise<FileSpec[]>;
}

/**
 * Mount the SSE channel that the agent-pod sidecar holds open.
 *
 * ADR-041: Auth is the per-instance Istio AuthorizationPolicy at the
 * waypoint — principal == URL `:id`. This handler resolves the instance
 * label-set (agentId, owner) by name. Topics are keyed by agent name
 * because connection grants are agent-scoped: every running instance of
 * the same agent sees the same set of granted connections, so they
 * share one topic.
 */
export function mountPodFilesEventsRoute(app: Hono, deps: PodFilesEventsDeps) {
  app.get("/api/instances/:id/pod-files/events", async (c) => {
    const instanceId = c.req.param("id")!;
    const identity = await resolveInstance(deps.k8s, instanceId);
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
        const snapshot = await deps
          .fetchSnapshot(owner, agentId)
          .catch((err) => {
            console.warn(
              `pod-files snapshot for owner=${owner} agent=${agentId} failed:`,
              err,
            );
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
