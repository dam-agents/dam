import type { SessionUpdate } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import type { PlatformTurnEndedParams } from "api-server-api";

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
  | ({ sessionUpdate: "platform_turn_ended" } & PlatformTurnEndedParams)
  | { sessionUpdate: "platform_clipped_replay" };

/** A consumer whose connection outlives one session must filter on `sessionId`,
 *  or it paints the wrong chat. A socket engaged to exactly one session must not
 *  — see `useAcpHistory`. */
export type UpdateHandler = (update: AcpUpdate, sessionId: string) => void;
