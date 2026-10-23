import type { InvocationOutput, InvocationOutputStream } from "api-server-api";

export const OUTPUT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

const MAX_UPLOAD_GRACE_MS = 5 * 60 * 1000;

export function scriptDeadline(start: Date, expiresAt: Date): Date {
  const ttlMs = expiresAt.getTime() - start.getTime();
  return new Date(
    expiresAt.getTime() - Math.min(MAX_UPLOAD_GRACE_MS, ttlMs / 4),
  );
}

export function outputKey(
  invocation: { id: string; rootDriverId: string },
  stream: InvocationOutputStream,
): string {
  return `invocation-outputs/${invocation.rootDriverId}/${invocation.id}/${stream}`;
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
