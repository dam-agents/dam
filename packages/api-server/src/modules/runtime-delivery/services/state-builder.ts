import {
  eq,
  type Db,
  agentSettings,
  agentSkills,
  connectionGrants,
  connections as connectionsTable,
} from "db";
import { agentConfigOptionsSchema } from "api-server-api";
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

/** `env` contributions for an agent's granted standalone secrets (secrets module, ADR-040). */
export interface SecretEnvSource {
  forAgent(agentId: string): Promise<Contribution[]>;
}

export function createStateBuilder(deps: {
  db: Db;
  outboxRepo: OutboxRepo;
  builtin: BuiltinContributions;
  secretEnv: SecretEnvSource;
}): StateBuilder {
  return {
    async build(agentId, capabilities): Promise<StatePayload> {
      const [granted, skills, harnessConfig, secretEnv] = await Promise.all([
        readGrantedContributions(deps.db, agentId),
        readSkillRefContributions(deps.db, agentId),
        readHarnessConfigContributions(deps.db, agentId),
        deps.secretEnv.forAgent(agentId),
      ]);
      const builtin = deps.builtin.for(agentId);
      const rawContribs = [
        ...builtin,
        ...granted,
        ...skills,
        ...harnessConfig,
        ...secretEnv,
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

async function readSkillRefContributions(
  db: Db,
  agentId: string,
): Promise<Contribution[]> {
  const rows = await db
    .select({
      source: agentSkills.source,
      name: agentSkills.name,
      version: agentSkills.version,
    })
    .from(agentSkills)
    .where(eq(agentSkills.agentId, agentId));
  return rows.map(
    (r): Contribution => ({
      kind: "skill-ref",
      sourceUrl: r.source,
      name: r.name,
      version: r.version,
    }),
  );
}

/** The agent's persistent harness defaults, as a single `harness-config`
 *  contribution. Omitted entirely when nothing is set, so the driver removes
 *  any keys it previously wrote. */
async function readHarnessConfigContributions(
  db: Db,
  agentId: string,
): Promise<Contribution[]> {
  const [row] = await db
    .select({
      model: agentSettings.model,
      mode: agentSettings.mode,
      configOptions: agentSettings.configOptions,
    })
    .from(agentSettings)
    .where(eq(agentSettings.agentId, agentId));
  if (!row) return [];

  const parsedOptions = agentConfigOptionsSchema.safeParse(row.configOptions);
  const configOptions = parsedOptions.success ? parsedOptions.data : {};
  const hasOptions = Object.keys(configOptions).length > 0;

  if (row.model === null && row.mode === null && !hasOptions) return [];

  return [
    {
      kind: "harness-config",
      ...(row.model !== null ? { model: row.model } : {}),
      ...(row.mode !== null ? { mode: row.mode } : {}),
      ...(hasOptions ? { configOptions } : {}),
    },
  ];
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
