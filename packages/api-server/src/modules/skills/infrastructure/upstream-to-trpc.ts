import { TRPCError } from "@trpc/server";
import type { ScanFailure, ScanFailureCode } from "api-server-api";
import { scanFailure, scanFailureMessage } from "../domain/scan-failure.js";
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

/**
 * The status each verdict answers with. A client that reads `data.scanFailure`
 * ignores this, but the CLI branches on the code alone, so the mapping is a
 * contract in its own right: the three outcomes it prints differently —
 * "pass --agent", "fix your connection", "the sandbox is the problem" — must
 * stay on three distinct codes.
 *
 * `needs_github_connection` therefore shares `FORBIDDEN` with
 * `repo_unreachable`: they are the two halves of one 401/404, told apart only
 * by a connections read, and both are resolved the same way.
 */
const TRPC_CODE: Record<ScanFailureCode, TRPCError["code"]> = {
  needs_github_connection: "FORBIDDEN",
  needs_sandbox: "PRECONDITION_FAILED",
  repo_unreachable: "FORBIDDEN",
  agent_unreachable: "INTERNAL_SERVER_ERROR",
  other: "INTERNAL_SERVER_ERROR",
};

/**
 * Build the tRPC error for a named scan failure. The verdict rides `cause`
 * because tRPC strips it from the wire envelope unless the errorFormatter
 * lifts it — which is exactly what lets a client tell a verdict apart from a
 * transport failure that never reached the server.
 */
export function scanFailureToTrpc(failure: ScanFailure): TRPCError {
  return new TRPCError({
    code: TRPC_CODE[failure.code],
    message: scanFailureMessage(failure),
    cause: { scanFailure: failure },
  });
}

export function scanFailureError(
  code: ScanFailureCode,
  override?: Partial<Omit<ScanFailure, "code">>,
): TRPCError {
  return scanFailureToTrpc(scanFailure(code, override));
}

/** Whether a throwable already carries a verdict, so the scan path's catch-all
 *  leaves it alone instead of flattening it into the generic one. */
export function hasScanFailure(err: unknown): boolean {
  return (
    err instanceof TRPCError &&
    !!err.cause &&
    typeof err.cause === "object" &&
    "scanFailure" in err.cause
  );
}

/** agent-runtime relays this envelope (status 0, no HTTP response) when the
 *  pod's request to GitHub died in transit — egress denied at the gateway or
 *  the gateway down. Never produced by GitHub itself. */
function isUnreachableUpstream(u: UpstreamGatewayError): boolean {
  return u.status === 0 || u.body?.error === "upstream_unreachable";
}

/**
 * Which named verdict a private-scan failure from the agent-runtime client
 * deserves, or null for errors this flow doesn't own (the caller's catch-all
 * turns those into the generic verdict and logs the original).
 *
 * The "can't reach the repo" family, all of which the user resolves the same
 * way — hence one verdict rather than three:
 * - 404: egress reached GitHub but the repo isn't in the connection's grant
 *   (or doesn't exist).
 * - 401: the injected credential is invalid — a revoked token, or the sentinel
 *   bearer reaching GitHub unswapped.
 * - `upstream_unreachable`: the pod couldn't reach GitHub at all.
 *
 * The caller narrows this to `needs_github_connection` when the sandbox has no
 * GitHub credential at all — a distinction the upstream status cannot make,
 * since an unswapped sentinel and a revoked token look identical from here.
 *
 * A pod that never answered (AgentRuntimeUnreachableError) is deliberately NOT
 * in that family: GitHub was never involved, so a "grant access" fix would be
 * misleading.
 *
 * Any other upstream status is still GitHub answering, so the verdict names
 * GitHub and reports the status — a number the user can quote in a bug report,
 * unlike the upstream body, which is where internal text would leak in.
 */
export function privateScanFailure(err: unknown): ScanFailure | null {
  if (err instanceof AgentRuntimeUpstreamError) {
    const { status } = err.upstream;
    if (
      status === 404 ||
      status === 401 ||
      isUnreachableUpstream(err.upstream)
    ) {
      return scanFailure("repo_unreachable");
    }
    return scanFailure("other", {
      title: "GitHub couldn't serve this repository",
      detail: `GitHub answered with status ${status}. Try re-scanning in a moment.`,
    });
  }
  if (err instanceof AgentRuntimeUnreachableError) {
    return scanFailure("agent_unreachable");
  }
  return null;
}
