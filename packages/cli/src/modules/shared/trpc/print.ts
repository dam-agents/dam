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
  // serverCode set ⇒ the server was reached and rejected the request; print its
  // reason. Only a genuine connectivity failure gets "cannot reach server".
  if (error.serverCode) {
    process.stderr.write(`error: ${error.reason}\n`);
    return;
  }
  process.stderr.write(`error: ${formatTransportError(error.reason, host)}\n`);
}

export function printTrpcError(e: unknown, host: string): void {
  const r = classifyTrpcError(e);
  // classifyTrpcError never returns ok — this guard only narrows the Result.
  if (r.ok) return;
  printServiceError(r.error, host);
}
