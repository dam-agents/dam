import { TRPCError } from "@trpc/server";
import {
  AgentRuntimeUnreachableError,
  AgentRuntimeUpstreamError,
  type UpstreamGatewayError,
} from "./agent-runtime-client.js";

/**
 * Translate a structured upstream error (relayed by agent-runtime as HTTP
 * 502 with a `.upstream` envelope) into a tRPC error the UI can act on.
 *
 * We encode the `connect_url` / `manage_url` into the message as a
 * `platform-cta:<url>` prefix segment that the client can split back out. Keeps
 * the server → client contract simple (no tRPC data extension needed).
 *
 * Shared across the publish and scan flows — both delegate to agent-runtime
 * and both relay the same upstream envelope.
 */
export function upstreamToTrpc(err: AgentRuntimeUpstreamError): TRPCError {
  const { status, body } = err.upstream;
  const message = body?.message ?? err.message;
  const cta = body?.connect_url ?? body?.manage_url;
  const encoded = cta ? `${message}\nplatform-cta:${cta}` : message;

  if (
    body?.error === "app_not_connected" ||
    body?.error === "access_restricted"
  ) {
    return new TRPCError({ code: "PRECONDITION_FAILED", message: encoded });
  }
  if (isUnreachableUpstream(err.upstream)) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `GitHub is unreachable from the agent (${message}); try again in a moment.`,
    });
  }
  if (status === 403) {
    return new TRPCError({
      code: "FORBIDDEN",
      message: `GitHub rejected the request (${message}). Reconnect GitHub with the repo scope.`,
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

/** All private-scan failure shapes that mean "the connection can't reach the
 *  repo" to the user. Hedged because a 404 can't distinguish "private,
 *  ungranted" from "doesn't exist". */
export const SCAN_ACCESS_MESSAGE =
  "Can't access this repository. If it's private, grant your GitHub connection access to it, " +
  "then re-scan — otherwise, double-check the repo URL.";

/** agent-runtime relays this envelope (status 0, no HTTP response) when the
 *  pod's request to GitHub died in transit — egress denied at the gateway or
 *  the gateway down. Never produced by GitHub itself. */
function isUnreachableUpstream(u: UpstreamGatewayError): boolean {
  return u.status === 0 || u.body?.error === "upstream_unreachable";
}

/**
 * Translate a private-scan failure from the agent-runtime client into the
 * tRPC error the catalog UI renders, or return null for errors this flow
 * doesn't own (the caller rethrows those raw so genuine bugs stay visible).
 *
 * The "can't reach the repo" family — one hedged FORBIDDEN whose message the
 * UI pairs with a Manage-connections affordance:
 * - 404: egress reached GitHub but the repo isn't in the connection's grant
 *   (or doesn't exist).
 * - 401: the injected credential is invalid — no GitHub connection for this
 *   agent (the sentinel bearer reached GitHub unswapped) or a revoked token.
 * - `upstream_unreachable`: the pod couldn't reach GitHub at all.
 *
 * A pod that never answered (AgentRuntimeUnreachableError) is deliberately
 * NOT in that family: GitHub was never involved, so it maps to a plain
 * retryable error instead of a misleading "grant access" CTA.
 */
export function privateScanErrorToTrpc(err: unknown): TRPCError | null {
  if (err instanceof AgentRuntimeUpstreamError) {
    const { status } = err.upstream;
    if (
      status === 404 ||
      status === 401 ||
      isUnreachableUpstream(err.upstream)
    ) {
      return new TRPCError({ code: "FORBIDDEN", message: SCAN_ACCESS_MESSAGE });
    }
    return upstreamToTrpc(err);
  }
  if (err instanceof AgentRuntimeUnreachableError) {
    return new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The agent couldn't be reached to scan this source; try re-scanning in a moment.",
    });
  }
  return null;
}
