import { TRPCClientError } from "@trpc/client";
import type { Result } from "../../../result.js";
import { EXIT_RUNTIME_FAILURE } from "../exit-codes.js";
import type { AuthRequiredError, TransportError } from "../errors.js";
import { formatAuthRejection } from "../auth-message.js";
import { classifyTrpcError, trpcErrorCode } from "./classify.js";

export interface ErrorDescription {
  stderr: string;
  exitCode: number;
}

export function formatTransportError(reason: string, host: string): string {
  return `cannot reach server \`${host}\`: ${reason}`;
}

export function serverDetail(e: unknown): string {
  if (!(e instanceof TRPCClientError)) return "";
  const code = trpcErrorCode(e);
  return e.message && e.message !== code ? e.message : "";
}

export function serviceErrorDescription(
  error: TransportError | AuthRequiredError,
  host: string,
): ErrorDescription {
  if (error.kind === "auth-required") {
    return {
      stderr: formatAuthRejection(error.reason),
      exitCode: EXIT_RUNTIME_FAILURE,
    };
  }
  if (error.serverCode) {
    return {
      stderr: `error: ${error.reason}\n`,
      exitCode: EXIT_RUNTIME_FAILURE,
    };
  }
  return {
    stderr: `error: ${formatTransportError(error.reason, host)}\n`,
    exitCode: EXIT_RUNTIME_FAILURE,
  };
}

export function printServiceError(
  error: TransportError | AuthRequiredError,
  host: string,
): void {
  process.stderr.write(serviceErrorDescription(error, host).stderr);
}

export function exitOnServiceError<T>(
  result: Result<T, TransportError | AuthRequiredError>,
  host: string,
): asserts result is { ok: true; value: T };
export function exitOnServiceError<T, E>(
  result: Result<T, E>,
  host: string,
  describe: (error: E, host: string) => ErrorDescription,
): asserts result is { ok: true; value: T };
export function exitOnServiceError<T, E>(
  result: Result<T, E>,
  host: string,
  describe?: (error: E, host: string) => ErrorDescription,
): asserts result is { ok: true; value: T } {
  if (result.ok) return;
  const { stderr, exitCode } = describe
    ? describe(result.error, host)
    : serviceErrorDescription(
        result.error as TransportError | AuthRequiredError,
        host,
      );
  process.stderr.write(stderr);
  process.exit(exitCode);
}

export function printTrpcError(e: unknown, host: string): void {
  const r = classifyTrpcError(e);
  if (r.ok) return;
  printServiceError(r.error, host);
}
