import { TRPCError } from "@trpc/server";
import { AgentRuntimeUpstreamError } from "./agent-runtime-client.js";

/**
 * Translate an OneCLI gateway error (relayed by agent-runtime as HTTP 502
 * with a `.upstream` envelope) into a tRPC error the UI can act on.
 *
 * We encode the `connect_url` / `manage_url` into the message as a
 * `humr-cta:<url>` prefix segment that the client can split back out. Keeps
 * the server → client contract simple (no tRPC data extension needed).
 *
 * Shared across the publish and scan flows — both delegate to agent-runtime
 * and both relay the same upstream envelope.
 */
export function upstreamToTrpc(err: AgentRuntimeUpstreamError): TRPCError {
  const { status, body } = err.upstream;
  const message = body?.message ?? err.message;
  const cta = body?.connect_url ?? body?.manage_url;
  const encoded = cta ? `${message}\nhumr-cta:${cta}` : message;

  if (body?.error === "app_not_connected" || body?.error === "access_restricted") {
    return new TRPCError({ code: "PRECONDITION_FAILED", message: encoded });
  }
  if (status === 403) {
    return new TRPCError({
      code: "FORBIDDEN",
      message: `GitHub rejected the request (${message}). Reconnect GitHub in OneCLI with the repo scope.`,
    });
  }
  if (status === 404) {
    return new TRPCError({ code: "NOT_FOUND", message: `GitHub: ${message}` });
  }
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: `GitHub ${status}: ${message}`,
  });
}
