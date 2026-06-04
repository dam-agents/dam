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
    } else {
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
