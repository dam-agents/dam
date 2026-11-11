import type { InvocationOutput, InvocationOutputStream } from "api-server-api";

export const OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_UPLOAD_GRACE_MS = 5 * 60 * 1000;

export function scriptDeadline(start: Date, expiresAt: Date): Date {
  const ttlMs = expiresAt.getTime() - start.getTime();
  return new Date(
    expiresAt.getTime() - Math.min(MAX_UPLOAD_GRACE_MS, ttlMs / 4),
  );
}

// UNIT_BOUNDARY_DESCRIPTION: where a script run's stream is kept: under its target, and under its own run, since a kept target runs several scripts, at once too; a run from before runs had their own rows (its id is the target's) keeps the key it was uploaded to.
export function outputKey(
  run: { id: string; rootDriverId: string; runId: string | null },
  stream: InvocationOutputStream,
): string {
  const target = `invocation-outputs/${run.rootDriverId}/${run.id}`;
  if (run.runId === null || run.runId === run.id) return `${target}/${stream}`;
  return `${target}/runs/${run.runId.replace(/[^A-Za-z0-9_.-]/g, "_")}/${stream}`;
}

export function heldStreams(
  output: InvocationOutput | null,
): InvocationOutputStream[] {
  if (!output) return [];
  return (["stdout", "stderr"] as const).filter((s) => output[s] !== undefined);
}

export function runtimeRunsScripts(capabilities: unknown): boolean {
  const events = (capabilities as { events?: unknown } | null)?.events;
  return Array.isArray(events) && events.includes("invocation-script");
}
