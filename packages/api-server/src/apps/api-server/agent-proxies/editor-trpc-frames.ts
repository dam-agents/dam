const CALL_METHODS = new Set(["query", "mutation", "subscription"]);

const FORBIDDEN_JSONRPC_CODE = -32003;

interface TrpcFrame {
  id?: unknown;
  jsonrpc?: unknown;
  method?: unknown;
  params?: { path?: unknown };
}

export interface ScreenedFrame {
  forward: string | null;
  refusals: string[];
  mutations: string[];
}

function refusal(frame: TrpcFrame, path: string): string {
  return JSON.stringify({
    id: frame.id,
    ...(frame.jsonrpc !== undefined && { jsonrpc: frame.jsonrpc }),
    error: {
      code: FORBIDDEN_JSONRPC_CODE,
      message: "Only the agent's owner can do this.",
      data: { code: "FORBIDDEN", httpStatus: 403, path },
    },
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Checks one message an Agent Editor sends on the
 * runtime's tRPC socket. A message holds one tRPC call or an array of them.
 * Each call whose procedure the editor may not reach is taken out and
 * answered here with a FORBIDDEN error frame for its id, so the runtime never
 * sees it and the client's call fails as it would over HTTP. Everything else,
 * such as a subscription stop or the keep-alive ping, passes unchanged.
 */
export function screenEditorFrame(
  data: string,
  mayCall: (path: string) => boolean,
): ScreenedFrame {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return { forward: data, refusals: [], mutations: [] };
  }
  const batch = Array.isArray(parsed);
  const frames = (batch ? parsed : [parsed]) as TrpcFrame[];
  const kept: TrpcFrame[] = [];
  const refusals: string[] = [];
  const mutations: string[] = [];
  for (const frame of frames) {
    if (
      typeof frame !== "object" ||
      frame === null ||
      !CALL_METHODS.has(frame.method as string)
    ) {
      kept.push(frame);
      continue;
    }
    const path =
      typeof frame.params?.path === "string" ? frame.params.path : "";
    if (!mayCall(path)) {
      refusals.push(refusal(frame, path));
      continue;
    }
    kept.push(frame);
    if (frame.method === "mutation") mutations.push(path);
  }
  if (refusals.length === 0) return { forward: data, refusals, mutations };
  const forward =
    kept.length === 0 ? null : JSON.stringify(batch ? kept : kept[0]);
  return { forward, refusals, mutations };
}
