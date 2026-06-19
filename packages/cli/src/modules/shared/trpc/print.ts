import { TRPCClientError } from "@trpc/client";
import type { AuthRequiredError, TransportError } from "../errors.js";
import { formatAuthRejection } from "../auth-message.js";
import { classifyTrpcError } from "./classify.js";

export function formatTransportError(reason: string, host: string): string {
  return `cannot reach server \`${host}\`: ${reason}`;
}

export function printServiceError(
  error: TransportError | AuthRequiredError,
  host: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (error.kind === "auth-required") {
    process.stderr.write(formatAuthRejection(error.reason, env));
    return;
  }
  process.stderr.write(`error: ${formatTransportError(error.reason, host)}\n`);
}

export function printTrpcError(e: unknown, host: string): void {
  const r = classifyTrpcError(e);
  // Narrowing only — classifyTrpcError never returns ok (it returns err or
  // throws), but TS won't drop the Result<never, …> success arm on its own,
  // so without this guard r.error below doesn't type-check.
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
