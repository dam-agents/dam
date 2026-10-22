import { BOB_HOST, type ProviderOutageReason } from "api-server-api";
import { match } from "ts-pattern";

export type PublicReason = Exclude<ProviderOutageReason, "failing-calls">;

export interface PublicSignal {
  readonly templateId: string;
  readonly reason: PublicReason;
  readonly since: string;
}

export interface SourceStreak {
  readonly failedRuns: number;
  readonly since: string;
}

export type SourceStreaks = Readonly<
  Partial<Record<PublicSource, SourceStreak>>
>;

export interface StatusComponent {
  readonly name: string;
  readonly status: string;
}

export interface BobService {
  readonly name: string;
  readonly originalName: string;
  readonly status: string;
}

export type ProxySource = "curve-bender" | "ibm-litellm";
export type PublicSource = ProxySource | "claude" | "openai" | "bob";

export type SourceReading =
  | { readonly source: ProxySource; readonly healthy: boolean }
  | {
      readonly source: "claude" | "openai";
      readonly components: readonly StatusComponent[] | null;
    }
  | { readonly source: "bob"; readonly services: readonly BobService[] | null };

export const SOURCE_TEMPLATES: Readonly<
  Record<PublicSource, readonly string[]>
> = {
  "curve-bender": ["curve-bender", "curve-bender-deployment"],
  "ibm-litellm": ["ibm-litellm"],
  claude: ["anthropic", "anthropic-oauth"],
  openai: ["openai"],
  bob: ["bob"],
};

export const STATUS_PAGES: Readonly<Record<string, string>> = {
  anthropic: "https://status.claude.com",
  "anthropic-oauth": "https://status.claude.com",
  openai: "https://status.openai.com",
  bob: "https://status.bob.ibm.com",
};

const CLAUDE_COMPONENTS: ReadonlyArray<[string, readonly string[]]> = [
  ["Claude API (api.anthropic.com)", ["anthropic", "anthropic-oauth"]],
  ["Claude Code", ["anthropic-oauth"]],
];

const OPENAI_COMPONENTS: ReadonlyArray<[string, readonly string[]]> = [
  ["Chat Completions", ["openai"]],
  ["Responses", ["openai"]],
];

const OUTAGE_STATUSES: ReadonlySet<string> = new Set([
  "partial_outage",
  "major_outage",
]);

const PROXY_FAILED_RUNS = 2;

const BOB_SERVICE = "Chat/Code Completion";
const BOB_REGION = BOB_HOST.split(".")[1] ?? "";

export function sourcesInUse(templateIds: Iterable<string>): PublicSource[] {
  const inUse = new Set(templateIds);
  return (Object.keys(SOURCE_TEMPLATES) as PublicSource[]).filter((source) =>
    SOURCE_TEMPLATES[source].some((templateId) => inUse.has(templateId)),
  );
}

export function answered(reading: SourceReading): boolean {
  return match(reading)
    .with(
      { source: "curve-bender" },
      { source: "ibm-litellm" },
      (r) => r.healthy,
    )
    .with(
      { source: "claude" },
      { source: "openai" },
      (r) => r.components !== null,
    )
    .with({ source: "bob" }, (r) => r.services !== null)
    .exhaustive();
}

export function nextStreaks(
  previous: SourceStreaks,
  readings: readonly SourceReading[],
  at: string,
): SourceStreaks {
  const streaks: Partial<Record<PublicSource, SourceStreak>> = {};
  for (const reading of readings) {
    if (answered(reading)) continue;
    const streak = previous[reading.source];
    streaks[reading.source] = {
      failedRuns: (streak?.failedRuns ?? 0) + 1,
      since: streak?.since ?? at,
    };
  }
  return streaks;
}

function componentSignals(
  components: readonly StatusComponent[] | null,
  watched: ReadonlyArray<[string, readonly string[]]>,
  at: string,
): PublicSignal[] {
  const down = new Set<string>();
  for (const [name, templateIds] of watched) {
    const component = components?.find((c) => c.name === name);
    if (component && OUTAGE_STATUSES.has(component.status))
      for (const templateId of templateIds) down.add(templateId);
  }
  return [...down].map((templateId) => ({
    templateId,
    reason: "provider-reported",
    since: at,
  }));
}

function bobSignals(
  services: readonly BobService[] | null,
  at: string,
): PublicSignal[] {
  const checks = (services ?? []).filter(
    (s) => s.name === BOB_SERVICE && s.originalName.includes(`_${BOB_REGION}_`),
  );
  return checks.some((s) => s.status !== "operational")
    ? [{ templateId: "bob", reason: "provider-reported", since: at }]
    : [];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the signals of one public source. A proxy counts
 * as unreachable only after its readiness check failed in two runs in a row,
 * so a single slow or reset check does not tell every user that the provider
 * is down; the outage then starts at the first failed run. A status page
 * already reports what its provider confirmed, so one reading is enough.
 */
export function signalsOf(
  reading: SourceReading,
  streak: SourceStreak | undefined,
  at: string,
): PublicSignal[] {
  return match(reading)
    .with({ source: "curve-bender" }, { source: "ibm-litellm" }, (r) =>
      streak && streak.failedRuns >= PROXY_FAILED_RUNS
        ? [
            {
              templateId: r.source,
              reason: "unreachable" as const,
              since: streak.since,
            },
          ]
        : [],
    )
    .with({ source: "claude" }, (r) =>
      componentSignals(r.components, CLAUDE_COMPONENTS, at),
    )
    .with({ source: "openai" }, (r) =>
      componentSignals(r.components, OPENAI_COMPONENTS, at),
    )
    .with({ source: "bob" }, (r) => bobSignals(r.services, at))
    .exhaustive();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the templates whose public source answered in
 * this run and did not report them. A source that gave no answer clears
 * nothing. An answered reading has no streak, because `nextStreaks` counts
 * only the runs that failed.
 */
export function clearedTemplates(
  readings: readonly SourceReading[],
  at: string,
): string[] {
  return readings.filter(answered).flatMap((reading) => {
    const reported = new Set(
      signalsOf(reading, undefined, at).map((signal) => signal.templateId),
    );
    return SOURCE_TEMPLATES[reading.source].filter(
      (templateId) => !reported.has(templateId),
    );
  });
}
