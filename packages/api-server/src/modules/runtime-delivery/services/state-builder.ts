import {
  eq,
  type Db,
  connectionGrants,
  connections as connectionsTable,
} from "db";
import {
  contribution as contributionSchema,
  event as eventSchema,
} from "agent-runtime-api";
import type {
  Contribution,
  RuntimeEvent as Event,
  RuntimeEventKind,
} from "api-server-api";
import { contributionHash } from "../domain/contribution-hash.js";
import {
  filterByCapabilities,
  type AgentCapabilities,
} from "../domain/capability-filter.js";
import type {
  OutboxRepo,
  PendingEventRow,
} from "../infrastructure/outbox-repo.js";

/**
 * Computes the apply payload for one agent (ADR-052 §"State semantics").
 * Same builder is used by the worker (dispatch path) and the hello handler
 * (catch-up path) — one definition of "what should this agent have right
 * now".
 *
 * Reads:
 *  - granted Connections (via `connection_grants` join `connections`) →
 *    flatten `contributions[]` per Connection.
 *  - non-dispatched, non-expired events (via OutboxRepo).
 *  - the agent's advertised capabilities (caller-supplied; usually from
 *    the agents-runtime repo).
 *
 * Filters by capabilities, computes a deterministic hash, returns a payload
 * ready for `applyState`.
 */
export interface StatePayload {
  contributions: Contribution[];
  hash: string;
  events: Event[];
  droppedContributionKinds: string[];
  droppedEventKinds: string[];
}

export interface StateBuilder {
  build(
    agentId: string,
    capabilities: AgentCapabilities,
  ): Promise<StatePayload>;
}

export function createStateBuilder(deps: {
  db: Db;
  outboxRepo: OutboxRepo;
}): StateBuilder {
  return {
    async build(agentId, capabilities): Promise<StatePayload> {
      const rawContribs = await readGrantedContributions(deps.db, agentId);
      const pending = await deps.outboxRepo.pendingEvents(agentId);
      const events = pending.map(toEvent).filter((e): e is Event => e !== null);
      const filtered = filterByCapabilities(capabilities, rawContribs, events);
      return {
        contributions: filtered.contributions,
        hash: contributionHash(filtered.contributions),
        events: filtered.events,
        droppedContributionKinds: filtered.droppedContributionKinds,
        droppedEventKinds: filtered.droppedEventKinds,
      };
    },
  };
}

async function readGrantedContributions(
  db: Db,
  agentId: string,
): Promise<Contribution[]> {
  const rows = (await db
    .select({
      contributions: connectionsTable.contributions,
    })
    .from(connectionGrants)
    .innerJoin(
      connectionsTable,
      eq(connectionGrants.connectionId, connectionsTable.id),
    )
    .where(eq(connectionGrants.agentId, agentId))) as {
    contributions: unknown;
  }[];

  // Defensive parse — a Connection row's `contributions` is jsonb. We
  // validate against the schema so a hand-edited row can't poison a
  // payload.
  const out: Contribution[] = [];
  for (const row of rows) {
    if (!Array.isArray(row.contributions)) continue;
    for (const raw of row.contributions) {
      const parsed = contributionSchema.safeParse(raw);
      if (parsed.success) out.push(parsed.data);
    }
  }
  return out;
}

function toEvent(row: PendingEventRow): Event | null {
  // Validate through the canonical schema. Lets a malformed row drop with
  // a log instead of poisoning the payload.
  const candidate = {
    id: row.id,
    kind: row.kind as RuntimeEventKind,
    version: row.version,
    expiresAt: row.expiresAt.toISOString(),
    payload: row.payload,
  };
  const parsed = eventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}
