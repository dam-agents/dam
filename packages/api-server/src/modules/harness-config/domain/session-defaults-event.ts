import type { SessionDefaultsEventPayload } from "agent-runtime-api";
import type { SessionDefaults } from "api-server-api";

const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the runtime keeps the defaults each kind of
 * session follows, so a session on its default takes the newest one at its
 * next turn without asking the api-server. The event carries the effective
 * defaults: an unsaved channel or scheduled default is the chat one. Each
 * event replaces the last, so any newer one makes an older one moot. The id
 * ends in `at`, which the runtime reads to skip an event no newer than the
 * last one it ran, so the publisher hands out a strictly increasing `at`.
 */
export function sessionDefaultsEvent(
  agentId: string,
  saved: SessionDefaults,
  at: number,
) {
  const payload: SessionDefaultsEventPayload = {
    chat: saved.chat,
    channel: saved.channel ?? saved.chat,
    scheduled: saved.scheduled ?? saved.chat,
  };
  return {
    id: `session-defaults:${agentId}:${at}`,
    kind: "session-defaults" as const,
    payload,
    expiresAt: new Date(at + EVENT_TTL_MS),
  };
}
