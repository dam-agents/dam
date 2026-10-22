export const WINDOW_MINUTES = 5;

const MIN_FAILED_CALLS = 3;
const MIN_FAILED_AGENTS = 2;

export interface WindowBucket {
  readonly calls: number;
  readonly failures: number;
  readonly agents: readonly string[];
  readonly failedAgents: readonly string[];
}

export function minuteOf(at: Date): number {
  return Math.floor(at.getTime() / 60_000);
}

export function windowMinutes(now: Date): number[] {
  const last = minuteOf(now);
  return Array.from({ length: WINDOW_MINUTES }, (_, i) => last - i);
}

export function failedAgentsOf(buckets: readonly WindowBucket[]): Set<string> {
  return new Set(buckets.flatMap((b) => b.failedAgents));
}

export function hasSucceededCalls(buckets: readonly WindowBucket[]): boolean {
  let calls = 0;
  let failures = 0;
  for (const bucket of buckets) {
    calls += bucket.calls;
    failures += bucket.failures;
  }
  return calls > failures;
}

export function answeringTemplates(
  calls: ReadonlyMap<string, readonly WindowBucket[]>,
): string[] {
  return [...calls]
    .filter(([, buckets]) => hasSucceededCalls(buckets))
    .map(([templateId]) => templateId);
}

export function isDegraded(buckets: readonly WindowBucket[]): boolean {
  let calls = 0;
  let failures = 0;
  const agents = new Set<string>();
  const failedAgents = new Set<string>();
  for (const bucket of buckets) {
    calls += bucket.calls;
    failures += bucket.failures;
    for (const agent of bucket.agents) agents.add(agent);
    for (const agent of bucket.failedAgents) failedAgents.add(agent);
  }
  return (
    failures >= MIN_FAILED_CALLS &&
    failures * 2 >= calls &&
    (failedAgents.size >= MIN_FAILED_AGENTS ||
      failedAgents.size === agents.size)
  );
}
