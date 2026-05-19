/** Sentinel session id prefix for ACP frames that aren't tied to a real
 *  session. The UI dispatches on this prefix to route them to the inbox
 *  surface rather than the in-session permission queue. */
export const SYNTHETIC_SESSION_PREFIX = "_egress:";

export function syntheticSessionId(approvalId: string): string {
  return `${SYNTHETIC_SESSION_PREFIX}${approvalId}`;
}

export interface SynthFrameInput {
  approvalId: string;
  host: string;
  method: string;
  path: string;
}

/** ACP `session/request_permission` synth frame for an ext_authz pending
 *  approval. Options match the inbox actions; the toolCall metadata carries
 *  the originating request so the UI can render it without re-querying.
 *
 *  The JSON-RPC `id` is required: the ACP SDK routes id-bearing messages to
 *  the request-handler path (`requestPermission`), where the UI's synth-prefix
 *  guard diverts to the inbox. Without an `id` the SDK would route to
 *  `extNotification` and the live-UI prompt never surfaces. The id is the
 *  approvalId itself — a UUID, so it can't collide with the wrapper's
 *  integer-counter request ids; nothing responds to it upstream because
 *  `awaitPermission` returns a never-resolving promise on the synth path. */
export function buildExtAuthzSynthFrame(input: SynthFrameInput): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: input.approvalId,
    method: "session/request_permission",
    params: {
      sessionId: syntheticSessionId(input.approvalId),
      options: [
        { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
        {
          optionId: "allow_always",
          name: "Allow permanently",
          kind: "allow_always",
        },
        {
          optionId: "reject_always",
          name: "Deny forever",
          kind: "reject_always",
        },
      ],
      toolCall: {
        toolCallId: syntheticSessionId(input.approvalId),
        kind: "other",
        status: "pending",
        title: `${input.method} ${input.host}${input.path}`,
        rawInput: {
          approvalId: input.approvalId,
          host: input.host,
          method: input.method,
          path: input.path,
        },
      },
    },
  });
}

/** Redis channel pattern for fanning synth frames to the relay's clients. */
export const INJECT_CHANNEL_PREFIX = "inject:";
export const injectChannelOf = (instanceId: string): string =>
  `${INJECT_CHANNEL_PREFIX}${instanceId}`;
