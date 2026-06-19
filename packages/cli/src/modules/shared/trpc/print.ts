import { TRPCClientError } from "@trpc/client";
import type { AuthRequiredError, TransportError } from "../errors.js";
import { DAM_TOKEN_ENV_VAR } from "../../auth/infrastructure/auth-env-reader.js";
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
    process.stderr.write(`error: not authenticated: ${error.reason}\n`);
    // Under DAM_TOKEN the bearer is supplied verbatim and never lives in
    // auth.toml, so `dam auth login` can't fix it — the token itself was
    // rejected. Point at the env var instead.
    process.stderr.write(
      env[DAM_TOKEN_ENV_VAR]
        ? "hint: DAM_TOKEN was rejected — check it is valid and unexpired\n"
        : "hint: run `dam auth login` first\n",
    );
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
