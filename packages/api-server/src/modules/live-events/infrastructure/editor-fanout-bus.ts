import { createTtlMap } from "../../../core/ttl-map.js";
import { formatError } from "../../../core/format-error.js";
import {
  editorAudience,
  isEditorAudience,
  type LiveEventsBus,
} from "../services/live-events-service.js";

const EDITORS_TTL_MS = 30_000;

const EDITOR_TOPICS: ReadonlySet<string> = new Set([
  "agents",
  "schedules",
  "harnessConfig",
  "approvals",
  "attention",
]);

export interface EditorFanoutBus extends LiveEventsBus {
  forgetEditors(agentId: string): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A live events bus that also tells an Agent's
 * Agent Editors when the Agent changes. Every publisher addresses the owner;
 * this copies each hint about the Agent, its schedules, its model settings,
 * its approvals and its sessions to the email audience of every editor of
 * that Agent. The Editor List is read from a short per-replica cache, dropped on
 * this replica when the list changes; another replica sees the change within
 * the cache's lifetime, and a person added or removed gets their own hint
 * from the change itself.
 */
export function createEditorFanoutBus(
  bus: LiveEventsBus,
  editorsOf: (agentId: string) => Promise<string[]>,
  log: (message: string) => void,
): EditorFanoutBus {
  const cache = createTtlMap<string, Promise<string[]>>({
    ttlMs: EDITORS_TTL_MS,
  });
  const cachedEditorsOf = (agentId: string) => {
    const hit = cache.get(agentId);
    if (hit) return hit;
    const read = editorsOf(agentId);
    cache.set(agentId, read);
    read.catch(() => cache.delete(agentId));
    return read;
  };
  return {
    publish(audience, event) {
      bus.publish(audience, event);
      const agentId =
        EDITOR_TOPICS.has(event.topic) && "agentId" in event
          ? event.agentId
          : undefined;
      if (agentId === undefined || isEditorAudience(audience)) return;
      cachedEditorsOf(agentId).then(
        (emails) => {
          for (const email of emails) bus.publish(editorAudience(email), event);
        },
        (err: unknown) =>
          log(`editor hints for ${agentId} failed: ${formatError(err)}`),
      );
    },
    subscribe: (audience, listener) => bus.subscribe(audience, listener),
    forgetEditors: (agentId) => cache.delete(agentId),
  };
}
