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

export const INJECT_CHANNEL_PREFIX = "inject:";
export const injectChannelOf = (agentId: string): string =>
  `${INJECT_CHANNEL_PREFIX}${agentId}`;
