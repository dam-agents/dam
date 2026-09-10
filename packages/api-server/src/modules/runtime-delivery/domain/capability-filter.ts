import type {
  Contribution,
  ContributionKind,
  RuntimeEvent,
  RuntimeEventKind,
} from "api-server-api";

type Event = RuntimeEvent;

export interface AgentCapabilities {
  contributions: ContributionKind[];
  events: RuntimeEventKind[];
}

export interface CapabilityFilterResult {
  contributions: Contribution[];
  events: Event[];
  droppedContributionKinds: ContributionKind[];
  droppedEventKinds: RuntimeEventKind[];
}

const HOST_RAIL_KINDS = new Set<ContributionKind>([
  "egress-allow",
  "egress-inject",
]);

export function filterByCapabilities(
  capabilities: AgentCapabilities,
  contributions: Contribution[],
  events: Event[],
): CapabilityFilterResult {
  const allowedContrib = new Set(capabilities.contributions);
  const allowedEvent = new Set(capabilities.events);

  const filteredContribs: Contribution[] = [];
  const droppedContribs = new Set<ContributionKind>();
  for (const c of contributions) {
    if (allowedContrib.has(c.kind)) {
      filteredContribs.push(c);
    } else if (!HOST_RAIL_KINDS.has(c.kind)) {
      droppedContribs.add(c.kind);
    }
  }

  const filteredEvents: Event[] = [];
  const droppedEvents = new Set<RuntimeEventKind>();
  for (const e of events) {
    if (allowedEvent.has(e.kind)) {
      filteredEvents.push(e);
    } else {
      droppedEvents.add(e.kind);
    }
  }

  return {
    contributions: filteredContribs,
    events: filteredEvents,
    droppedContributionKinds: Array.from(droppedContribs),
    droppedEventKinds: Array.from(droppedEvents),
  };
}

export function advertisedKindsChanged(prev: unknown, next: unknown): boolean {
  return advertisedKindsKey(prev) !== advertisedKindsKey(next);
}

function advertisedKindsKey(capabilities: unknown): string {
  const record = (capabilities ?? {}) as Record<string, unknown>;
  return JSON.stringify([
    sortedKinds(record.contributions),
    sortedKinds(record.events),
  ]);
}

export function kindSetChanged(prev: string[], next: string[]): boolean {
  return (
    JSON.stringify(sortedKinds(prev)) !== JSON.stringify(sortedKinds(next))
  );
}

function sortedKinds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const kinds = value.filter((k): k is string => typeof k === "string");
  return [...new Set(kinds)].sort();
}
