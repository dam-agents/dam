import { TRPCClientError } from "@trpc/client";
import type { Result } from "../../../result.js";
import { EXIT_RUNTIME_FAILURE } from "../exit-codes.js";
import type { AuthRequiredError, TransportError } from "../errors.js";
import { formatAuthRejection } from "../auth-message.js";
import { classifyTrpcError } from "./classify.js";

export function formatTransportError(reason: string, host: string): string {
  return `cannot reach server \`${host}\`: ${reason}`;
}

export function serverDetail(e: unknown): string {
  if (!(e instanceof TRPCClientError)) return "";
  const code = e.data?.code as string | undefined;
  return e.message && e.message !== code ? e.message : "";
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
  if (error.serverCode) {
    process.stderr.write(`error: ${error.reason}\n`);
    return;
  }
  process.stderr.write(`error: ${formatTransportError(error.reason, host)}\n`);
}

export function exitOnServiceError<T>(
  result: Result<T, TransportError | AuthRequiredError>,
  host: string,
): asserts result is { ok: true; value: T } {
  if (result.ok) return;
  printServiceError(result.error, host);
  process.exit(EXIT_RUNTIME_FAILURE);
}

export function printTrpcError(e: unknown, host: string): void {
  const r = classifyTrpcError(e);
  if (r.ok) return;
  printServiceError(r.error, host);
}
