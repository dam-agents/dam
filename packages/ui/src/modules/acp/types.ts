import type { SessionUpdate } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import {
  zSessionConfigOption,
  zSessionModelState,
  zSessionModeState,
} from "@agentclientprotocol/sdk/dist/schema/zod.gen.js";
import type { PlatformTurnEndedParams } from "api-server-api";
import { z } from "zod";

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

export type UpdateHandler = (update: AcpUpdate) => void;

/**
 * Shape of the per-session config payload we capture from `loadSession` /
 * `newSession` responses and persist to localStorage. SDK responses carry
 * extra `_meta` and `sessionId`; we only need this triple. Composes the
 * SDK's own Zod schemas for each field so the cached value is validated
 * against the same definitions the SDK uses on the wire.
 */
export const sessionConfigPayloadSchema = z.object({
  modes: zSessionModeState.nullish(),
  models: zSessionModelState.nullish(),
  configOptions: z.array(zSessionConfigOption).nullish(),
});

export type SessionConfigPayload = z.infer<typeof sessionConfigPayloadSchema>;
