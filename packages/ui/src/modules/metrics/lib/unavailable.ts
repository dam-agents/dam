import { TRPCClientError } from "@trpc/client";

/** Whether the read failed because this deployment has no telemetry store. The
 *  metrics service fails closed with `PRECONDITION_FAILED` rather than returning
 *  empty rows, so "no store" stays distinguishable from "no spend yet". Unlike a
 *  transient read failure, the verdict is deployment-wide and holds for every
 *  window — so a caller can stop offering periods to page through. */
export function isMetricsUnavailable(error: unknown): boolean {
  return (
    error instanceof TRPCClientError &&
    error.data?.code === "PRECONDITION_FAILED"
  );
}
