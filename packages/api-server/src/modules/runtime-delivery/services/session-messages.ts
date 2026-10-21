import {
  capabilities,
  sessionMessageEventPayload,
  type SessionMessageEventPayload,
} from "agent-runtime-api";
import type { RuntimeMutator } from "./runtime-mutator.js";
import type { EventOutcomeHandler } from "./hello-handler.js";
import type { EventLifecycleListener } from "./event-lifecycle.js";

export const SESSION_MESSAGE_KIND = "session-message";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a message is worth delivering only while the
 * work it steers is still going on. One that waited longer than this is dropped
 * rather than arriving out of context, and its sender is told.
 */
export const SESSION_MESSAGE_TTL_MS = 60 * 60 * 1000;

const QUOTE_MAX = 200;

export interface SessionMessageEvent {
  id: string;
  kind: typeof SESSION_MESSAGE_KIND;
  payload: SessionMessageEventPayload;
  expiresAt: Date;
}

export interface SessionMessages {
  accepts(agentId: string): Promise<boolean>;
  send(
    agentId: string,
    payload: SessionMessageEventPayload,
  ): Promise<SessionMessageEvent>;
  onOutcome: EventOutcomeHandler;
  onLifecycle: EventLifecycleListener;
}

function quoted(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > QUOTE_MAX ? `${flat.slice(0, QUOTE_MAX)}…` : flat;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Delivers messages between an agent's own
 * Sessions as session-message events, and closes the loop on the ones that
 * fail. The send tool can only say a message is queued; the runtime reports
 * the outcome later. A failed or expired message comes back to its sender as a
 * notice, so the sender learns what went wrong without waiting. A delivered
 * one says nothing, and a notice that fails is only logged, so notices never
 * loop.
 */
export function createSessionMessages(deps: {
  runtimeMutator: RuntimeMutator;
  readCapabilities: (agentId: string) => Promise<unknown>;
  newId: () => string;
  now?: () => number;
  log: (msg: string) => void;
}): SessionMessages {
  const now = deps.now ?? Date.now;

  async function send(
    agentId: string,
    payload: SessionMessageEventPayload,
  ): Promise<SessionMessageEvent> {
    const at = now();
    const event: SessionMessageEvent = {
      id: `${SESSION_MESSAGE_KIND}:${agentId}:${deps.newId()}:${at}`,
      kind: SESSION_MESSAGE_KIND,
      payload,
      expiresAt: new Date(at + SESSION_MESSAGE_TTL_MS),
    };
    await deps.runtimeMutator.bump(agentId, [event]);
    await deps.runtimeMutator.enqueueAfterCommit(agentId);
    return event;
  }

  async function tellSender(
    agentId: string,
    raw: unknown,
    why: string,
  ): Promise<void> {
    const parsed = sessionMessageEventPayload.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.notice) {
      deps.log(
        `[session-message] ${agentId}: a notice to ${message.sessionId} was not delivered either: ${why}`,
      );
      return;
    }
    const sender = message.from.sessionId;
    if (!sender) return;
    await send(agentId, {
      sessionId: sender,
      text: `Your message to session ${message.sessionId} was not delivered: ${why}\n\nIt read: "${quoted(message.text)}"`,
      from: {},
      notice: true,
    });
  }

  return {
    async accepts(agentId) {
      return (
        capabilities
          .safeParse(await deps.readCapabilities(agentId))
          .data?.events.includes(SESSION_MESSAGE_KIND) ?? false
      );
    },
    send,
    async onOutcome(event, input) {
      if (input.outcome === "ok") return;
      await tellSender(
        event.agentId,
        event.payload,
        input.detail ?? input.outcome,
      );
    },
    async onLifecycle(event, transition) {
      if (transition !== "expired") return;
      await tellSender(
        event.agentId,
        event.payload,
        "it waited an hour without reaching that session, so it was dropped",
      );
    },
  };
}
