import {
  callTRPCProcedure,
  getTRPCErrorFromUnknown,
  getTRPCErrorShape,
  type AnyTRPCRouter,
} from "@trpc/server";
import type { AcpChannel } from "./ports.js";

interface TrpcRequestEnvelope {
  id: string | number;
  jsonrpc?: "2.0";
  method: "query" | "mutation";
  params: { path: string; input: unknown };
}

export interface TrpcDispatchDeps {
  channel: Pick<AcpChannel, "send">;
  router: AnyTRPCRouter;
  ctx: unknown;
}

export function createTrpcDispatch(
  deps: TrpcDispatchDeps,
): (line: string) => Promise<boolean> {
  return async function tryHandle(line) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return false;
    }
    if (!isTrpcRequest(parsed)) return false;

    const { id, jsonrpc = "2.0", method, params } = parsed;
    try {
      const result = await callTRPCProcedure({
        router: deps.router,
        path: params.path,
        getRawInput: async () => params.input,
        ctx: deps.ctx,
        type: method,
        signal: new AbortController().signal,
        batchIndex: 0,
      });
      deps.channel.send({
        jsonrpc,
        id,
        result: { type: "data", data: result },
      });
    } catch (err) {
      const trpcErr = getTRPCErrorFromUnknown(err);
      const errorShape = getTRPCErrorShape({
        config: deps.router._def._config,
        error: trpcErr,
        type: method,
        path: params.path,
        input: params.input,
        ctx: deps.ctx,
      });
      deps.channel.send({
        jsonrpc,
        id,
        error: errorShape,
      });
    }
    return true;
  };
}

function isTrpcRequest(msg: unknown): msg is TrpcRequestEnvelope {
  if (!msg || typeof msg !== "object") return false;
  const m = msg as Record<string, unknown>;
  if (m.method !== "query" && m.method !== "mutation") return false;
  if (m.id === undefined || m.id === null) return false;
  if (typeof m.id !== "string" && typeof m.id !== "number") return false;
  if (!m.params || typeof m.params !== "object") return false;
  const params = m.params as Record<string, unknown>;
  return typeof params.path === "string";
}
