import { TRPCClientError } from "@trpc/client";

export function isMetricsUnavailable(error: unknown): boolean {
  return (
    error instanceof TRPCClientError &&
    error.data?.code === "PRECONDITION_FAILED"
  );
}
