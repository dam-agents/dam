import {
  asc,
  eq,
  type Db,
  agentEnv,
  agentSkills,
  connectionGrants,
  connections as connectionsTable,
} from "db";
import {
  contribution as contributionSchema,
  event as eventSchema,
} from "agent-runtime-api";
import {
  SHARED_KB_TEMPLATE_ID,
  type Contribution,
  type RuntimeEvent as Event,
  type RuntimeEventKind,
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
import type { BuiltinContributions } from "./builtin-contributions.js";

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
  builtin: BuiltinContributions;
}): StateBuilder {
  return {
    async build(agentId, capabilities): Promise<StatePayload> {
      const [userEnv, granted, skills] = await Promise.all([
        readUserEnvContributions(deps.db, agentId),
        readGrantedContributions(deps.db, agentId),
        readSkillRefContributions(deps.db, agentId),
      ]);
      const builtin = deps.builtin.for(agentId, {
        sharedKnowledgeBases: granted.templateIds.has(SHARED_KB_TEMPLATE_ID),
      });
      const rawContribs = [
        ...userEnv,
        ...builtin,
        ...granted.contributions,
        ...skills,
      ];
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

async function readUserEnvContributions(
  db: Db,
  agentId: string,
): Promise<Contribution[]> {
  const rows = await db
    .select({ name: agentEnv.name, value: agentEnv.value })
    .from(agentEnv)
    .where(eq(agentEnv.agentId, agentId))
    .orderBy(asc(agentEnv.name));
  return rows.map(
    (r): Contribution => ({
      kind: "env",
      name: r.name,
      placeholder: r.value,
    }),
  );
}

async function readGrantedContributions(
  db: Db,
  agentId: string,
): Promise<{ contributions: Contribution[]; templateIds: Set<string> }> {
  const rows = (await db
    .select({
      contributions: connectionsTable.contributions,
      templateId: connectionsTable.templateId,
    })
    .from(connectionGrants)
    .innerJoin(
      connectionsTable,
      eq(connectionGrants.connectionId, connectionsTable.id),
    )
    .where(eq(connectionGrants.agentId, agentId))
    .orderBy(asc(connectionsTable.createdAt), asc(connectionsTable.id))) as {
    contributions: unknown;
    templateId: string;
  }[];

  const out: Contribution[] = [];
  const templateIds = new Set<string>();
  for (const row of rows) {
    templateIds.add(row.templateId);
    if (!Array.isArray(row.contributions)) continue;
    for (const raw of row.contributions) {
      const parsed = contributionSchema.safeParse(raw);
      if (parsed.success) out.push(parsed.data);
    }
  }
  return { contributions: out, templateIds };
}

async function readSkillRefContributions(
  db: Db,
  agentId: string,
): Promise<Contribution[]> {
  const rows = await db
    .select({
      source: agentSkills.source,
      name: agentSkills.name,
      version: agentSkills.version,
      path: agentSkills.path,
    })
    .from(agentSkills)
    .where(eq(agentSkills.agentId, agentId))
    .orderBy(asc(agentSkills.source), asc(agentSkills.name));
  return rows.map(
    (r): Contribution => ({
      kind: "skill-ref",
      sourceUrl: r.source,
      name: r.name,
      version: r.version,
      ...(r.path !== null ? { path: r.path } : {}),
    }),
  );
}

function toEvent(row: PendingEventRow): Event | null {
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
