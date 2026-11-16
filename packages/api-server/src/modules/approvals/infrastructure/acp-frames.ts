export const SYNTHETIC_SESSION_PREFIX = "_egress:";

export function syntheticSessionId(approvalId: string): string {
  return `${SYNTHETIC_SESSION_PREFIX}${approvalId}`;
}

export interface SynthFrameInput {
  approvalId: string;
  host: string;
  port: number | undefined;
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
        title: `${input.method} ${input.host}${input.port ? `:${input.port}` : ""}${input.path}`,
        rawInput: {
          approvalId: input.approvalId,
          host: input.host,
          port: input.port,
          method: input.method,
          path: input.path,
        },
      },
    },
  });
}

// UNIT_BOUNDARY_DESCRIPTION: the in-session prompt of a held web search, for attached ACP clients such as the CLI: the same permission request a held network request raises, titled with the query, or with the model choosing it.
export function buildWebSearchSynthFrame(input: {
  approvalId: string;
  query: string | null;
}): string {
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
          name: "Always allow web search",
          kind: "allow_always",
        },
        {
          optionId: "reject_always",
          name: "Always deny web search",
          kind: "reject_always",
        },
      ],
      toolCall: {
        toolCallId: syntheticSessionId(input.approvalId),
        kind: "search",
        status: "pending",
        title: `Web search: ${input.query ?? "the model chooses the query"}`,
        rawInput: {
          approvalId: input.approvalId,
          kind: "web_search",
          query: input.query,
        },
      },
    },
  });
}

const INJECT_CHANNEL_PREFIX = "inject:";
export const injectChannelOf = (agentId: string): string =>
  `${INJECT_CHANNEL_PREFIX}${agentId}`;
