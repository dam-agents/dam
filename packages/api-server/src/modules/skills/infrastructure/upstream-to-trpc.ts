import { TRPCError } from "@trpc/server";
import type { ScanFailure, ScanFailureCode } from "api-server-api";
import { scanFailure, scanFailureMessage } from "../domain/scan-failure.js";
import {
  AgentRuntimeUnreachableError,
  AgentRuntimeUpstreamError,
  type UpstreamGatewayError,
} from "./agent-runtime-client.js";

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

const TRPC_CODE: Record<ScanFailureCode, TRPCError["code"]> = {
  needs_github_connection: "FORBIDDEN",
  needs_sandbox: "PRECONDITION_FAILED",
  repo_unreachable: "FORBIDDEN",
  agent_unreachable: "INTERNAL_SERVER_ERROR",
  source_path_not_found: "BAD_REQUEST",
  source_path_empty: "BAD_REQUEST",
  other: "INTERNAL_SERVER_ERROR",
};

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

export function hasScanFailure(err: unknown): boolean {
  return (
    err instanceof TRPCError &&
    !!err.cause &&
    typeof err.cause === "object" &&
    "scanFailure" in err.cause
  );
}

function isUnreachableUpstream(u: UpstreamGatewayError): boolean {
  return u.status === 0 || u.body?.error === "upstream_unreachable";
}

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
