import { TRPCClientError } from "@trpc/client";
import type { AuthRequiredError, TransportError } from "../errors.js";
import { classifyTrpcError } from "./classify.js";

export function formatTransportError(reason: string, host: string): string {
  return `cannot reach server \`${host}\`: ${reason}`;
}

export function printServiceError(
  error: TransportError | AuthRequiredError,
  host: string,
): void {
  if (error.kind === "auth-required") {
    process.stderr.write(`error: not authenticated: ${error.reason}\n`);
    process.stderr.write("hint: run `dam auth login` first\n");
    return;
  }
  process.stderr.write(`error: ${formatTransportError(error.reason, host)}\n`);
}

export function printTrpcError(e: unknown, host: string): void {
  const r = classifyTrpcError(e);
  if (r.ok) return;
  // A tRPC error envelope is an app-layer rejection, not a connectivity failure.
  if (
    r.error.kind === "transport" &&
    e instanceof TRPCClientError &&
    typeof e.data?.code === "string"
  ) {
    process.stderr.write(`error: ${r.error.reason}\n`);
    return;
  }
  printServiceError(r.error, host);
}
