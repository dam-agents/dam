import type {
  LoadSessionResponse,
  NewSessionResponse,
  SessionUpdate,
} from "@agentclientprotocol/sdk/dist/schema/types.gen.js";

/**
 * SDK `SessionUpdate` plus our two synthetic variants:
 *   - `platform_turn_ended` — emitted by `agent-runtime` and routed through the
 *     SDK's `extNotification` channel (`platform/turnEnded` method) so it bypasses
 *     the SDK's strict Zod validation on `SessionUpdate`. Marks prompt
 *     completion for non-originating viewers.
 *   - `platform_clipped_replay` — agent-runtime currently emits this as a raw
 *     `session/update` notification, which the SDK rejects via Zod
 *     (`zSessionUpdate` doesn't include the literal). The handler in
 *     `session-projection.ts` is dead code until the runtime is moved to the
 *     `extNotification` channel like `platform/turnEnded`.
 */
export type AcpUpdate =
  | SessionUpdate
  | { sessionUpdate: "platform_turn_ended"; sessionId?: string }
  | { sessionUpdate: "platform_clipped_replay" };

export type UpdateHandler = (update: AcpUpdate) => void;

/**
 * Shape of the per-session config payload we capture from `loadSession` /
 * `newSession` responses and persist to localStorage. SDK responses carry
 * extra `_meta` and `sessionId`; we only need this triple.
 */
export type SessionConfigPayload = Pick<
  LoadSessionResponse & NewSessionResponse,
  "modes" | "models" | "configOptions"
>;
