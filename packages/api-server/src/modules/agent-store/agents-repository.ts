import { randomUUID } from "node:crypto";
import { and, eq, sql, type Db, type DbTx } from "db";
import {
  controlAgentKitState,
  controlAgentL7Hosts,
  controlAgentSignals,
  controlAgents,
} from "db";
import { err, ok } from "../../core/result.js";
import { getLogger } from "../../core/logger.js";
import type {
  AgentActivityStamp,
  AgentSpecWrite,
  AgentSpecWriteResult,
  AgentsRepository,
} from "../agents/infrastructure/agents-repository.js";
import type { RunningAgentStateCache } from "../agents/infrastructure/agent-state-cache.js";
import type { KubeObject } from "../agents/infrastructure/k8s.js";
import {
  ACTIVE_SESSION_KEY,
  ANN_AGENT_KIND,
  ANN_IMAGE_UPDATE_FROM,
  ANN_IMAGE_UPDATE_REFUSED,
  ANN_KB_SHARE_ROOTS,
  ANN_KB_TEMPLATE,
  ANN_KIT_UPDATE_PENDING,
  ANN_KIT_UPDATE_SKIPPED,
  ANN_LIFETIME_MS,
  ANN_ROLL_REV,
  ANN_STARTER_KIT,
  ANN_STARTER_KIT_DEFAULT_MODEL,
  ANN_STARTER_KIT_ONBOARDED,
  ANN_STARTER_KIT_SEED,
  ANN_SWEEPABLE,
  DISABLED_KEY,
  INVOCATIONS_ACTIVE_KEY,
  LAST_ACTIVITY_KEY,
  RECLAIMED_AT_KEY,
  STOP_REQUESTED_KEY,
} from "../agents/infrastructure/labels.js";
import { parseInfraAgent } from "../agents/infrastructure/agent-mappers.js";
import { createAgentWake } from "../agents/infrastructure/agent-wake.js";
import {
  PAUSE_SETTLE_POLL_MS,
  PAUSE_SETTLE_TIMEOUT_MS,
  pollUntilReady,
} from "../agents/infrastructure/poll-until-ready.js";
import { readAgentRows, readOneAgent } from "./control-read.js";
import { resourceFromRows, rowsFromResource } from "./rows.js";
import { parseGoDurationNs } from "../../duration.js";

const STALE_ACTIVITY = new Date("1970-01-01T00:00:00Z");

type Spec = Record<string, unknown>;
type Annotations = Record<string, string | null>;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const timeOf = (value: string | undefined): Date | null => {
  if (value === undefined) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const splitRoots = (raw: string | null): string[] | null => {
  if (raw === null) return null;
  const roots = raw
    .split(",")
    .map((root) => root.trim())
    .filter((root) => root !== "");
  return roots.length > 0 ? roots : null;
};

const specOf = (patch: Spec): Spec => (patch.spec as Spec | undefined) ?? patch;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the api-server's Agent repository over the control
 * rows, behind the `agentStore.authority` gate.
 *
 * It answers the interface the custom-resource implementation answers, and
 * every answer is the same Agent the rest of the api-server already reads, so
 * the service, its tRPC contracts and the UI are unchanged by which store is
 * authoritative.
 *
 * What replaces the resourceVersion guard is the pair of columns the schema
 * bumped for it. A definition write names the generation it was decided from and
 * lands only if nothing rendered moved in between; a signal write is one
 * statement whose own predicate is the fact it depends on — the disable, the
 * stop request, the invocation pin version, the activity token — so no read
 * decides a write that a concurrent write invalidated. The sleep settle compares
 * the stop token it wrote, the precheck restore compares the activity token it
 * overwrote, and the reclaim mark is the one column it may read but never write.
 *
 * Connection grants belong to the connections module, which already owns that
 * table: a spec that carries grant ids is a projection of it and is not written
 * here, so the table keeps one writer.
 */
export function createControlAgentsRepository(
  db: Db,
  cache: RunningAgentStateCache,
): AgentsRepository {
  const readLive = async (id: string): Promise<KubeObject | null> => {
    const row = await readOneAgent(db, id);
    return row === null ? null : resourceFromRows(row);
  };

  const agentOf = async (id: string): Promise<KubeObject | null> =>
    cache.get(id);

  const ownedRow = async (tx: Db | DbTx, id: string, owner?: string) => {
    const rows = await tx
      .select()
      .from(controlAgents)
      .where(eq(controlAgents.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return owner !== undefined && row.ownerSub !== owner ? null : row;
  };

  const applyAnnotations = async (
    tx: Db | DbTx,
    id: string,
    annotations: Annotations,
    now: Date,
  ): Promise<void> => {
    const agents: Record<string, unknown> = {};
    const signals: Record<string, unknown> = {};
    const kit: Record<string, unknown> = {};
    let touchKit = false;

    const putKit = (column: string, value: unknown) => {
      kit[column] = value;
      touchKit = true;
    };

    for (const [key, raw] of Object.entries(annotations)) {
      const value = raw === null || raw === "" ? null : raw;
      switch (key) {
        case LAST_ACTIVITY_KEY:
          signals.lastActivityAt = timeOf(value ?? undefined);
          signals.lastActivityToken = value === null ? null : randomUUID();
          break;
        case ACTIVE_SESSION_KEY:
          signals.sessionPinned = value === "true";
          break;
        case INVOCATIONS_ACTIVE_KEY:
          signals.invocationPinned = value === "true";
          if (value !== "true")
            signals.invocationPinVersion = sql`${controlAgentSignals.invocationPinVersion} + 1`;
          break;
        case STOP_REQUESTED_KEY:
          signals.stopRequestedAt = timeOf(value ?? undefined);
          signals.stopRequestToken = value === null ? null : randomUUID();
          break;
        case DISABLED_KEY:
          signals.disabledAt = timeOf(value ?? undefined);
          break;
        case ANN_ROLL_REV:
          signals.rollRev = value ?? "";
          break;
        case ANN_SWEEPABLE:
          agents.sweepable = value === "true";
          break;
        case ANN_LIFETIME_MS:
          agents.lifetimeMs = value === null ? null : Number(value);
          break;
        case ANN_AGENT_KIND:
          agents.kind = value;
          break;
        case ANN_KB_TEMPLATE:
          agents.kbTemplateId = value;
          break;
        case ANN_KB_SHARE_ROOTS:
          agents.kbShareRoots = splitRoots(value);
          break;
        case ANN_IMAGE_UPDATE_FROM:
          agents.imageUpdateFrom = value;
          break;
        case ANN_IMAGE_UPDATE_REFUSED:
          agents.imageUpdateRefused = value;
          break;
        case ANN_STARTER_KIT:
          putKit("starterKit", value);
          break;
        case ANN_STARTER_KIT_ONBOARDED:
          putKit("onboardedAt", timeOf(value ?? undefined));
          break;
        case ANN_STARTER_KIT_DEFAULT_MODEL:
          putKit("defaultModel", value);
          break;
        case ANN_KIT_UPDATE_SKIPPED:
          putKit("skippedCommit", value?.toLowerCase() ?? null);
          break;
        case ANN_STARTER_KIT_SEED: {
          const seed = value === null ? undefined : JSON.parse(value);
          putKit("seedUrl", seed?.url ?? null);
          putKit("seedBranch", seed?.branch ?? null);
          putKit("seedCommit", seed?.commit?.toLowerCase() ?? null);
          break;
        }
        case ANN_KIT_UPDATE_PENDING: {
          const pending = value === null ? undefined : JSON.parse(value);
          putKit("pendingCommit", pending?.targetCommit?.toLowerCase() ?? null);
          putKit("pendingStartedAt", timeOf(pending?.startedAt));
          break;
        }
        case RECLAIMED_AT_KEY:
          throw new Error(
            "the reclaim mark is the controller's column: the api-server never writes it",
          );
        default:
          throw new Error(`unknown Agent annotation ${key}`);
      }
    }

    if (Object.keys(agents).length > 0)
      await tx
        .update(controlAgents)
        .set({ ...agents, updatedAt: now })
        .where(eq(controlAgents.id, id));
    if (Object.keys(signals).length > 0)
      await tx
        .update(controlAgentSignals)
        .set({ ...signals, updatedAt: now })
        .where(eq(controlAgentSignals.agentId, id));
    if (touchKit)
      await tx
        .insert(controlAgentKitState)
        .values({ agentId: id, ...kit, updatedAt: now })
        .onConflictDoUpdate({
          target: controlAgentKitState.agentId,
          set: { ...kit, updatedAt: now },
        });
  };

  const applySpec = async (
    tx: Db | DbTx,
    id: string,
    patch: Spec,
    now: Date,
  ): Promise<void> => {
    const values: Record<string, unknown> = {};
    const limits = (
      patch.resources as { limits?: Record<string, string> } | undefined
    )?.limits;
    if (patch.image !== undefined) values.image = text(patch.image) ?? "";
    if (patch.name !== undefined) values.name = text(patch.name) ?? "";
    if (patch.description !== undefined)
      values.description = text(patch.description) ?? null;
    if (patch.avatar !== undefined) values.avatar = text(patch.avatar) ?? null;
    if (patch.whispersOff !== undefined)
      values.whispersOff = patch.whispersOff === true;
    if (patch.harness !== undefined)
      values.harness = text(patch.harness) ?? null;
    if (patch.secretRef !== undefined)
      values.secretRef = text(patch.secretRef) ?? null;
    if (patch.imagePullSecretRef !== undefined)
      values.imagePullSecretRef = text(patch.imagePullSecretRef) ?? null;
    if (patch.telemetryAttributionId !== undefined)
      values.telemetryAttributionId =
        text(patch.telemetryAttributionId) ?? null;
    if (patch.requireConnectionAddress !== undefined)
      values.requireConnectionAddress = patch.requireConnectionAddress === true;
    if (patch.nestedVirtualization !== undefined)
      values.nestedVirtualization = patch.nestedVirtualization === true;
    if (patch.storageSize !== undefined)
      values.diskSize = text(patch.storageSize) ?? null;
    if (patch.hibernationTimeout !== undefined) {
      const raw =
        typeof patch.hibernationTimeout === "string"
          ? patch.hibernationTimeout
          : (patch.hibernationTimeout as { duration?: string }).duration;
      const parsed =
        raw === undefined || raw === "" ? null : parseGoDurationNs(raw);
      if (raw !== undefined && raw !== "" && parsed === null)
        throw new Error(`hibernationTimeout ${raw} is not a duration`);
      values.hibernationTimeoutNs = parsed === null ? null : Number(parsed);
    }
    if (limits?.cpu !== undefined) values.cpuLimit = limits.cpu;
    if (limits?.memory !== undefined) values.memoryLimit = limits.memory;

    if (Object.keys(values).length > 0)
      await tx
        .update(controlAgents)
        .set({ ...values, updatedAt: now })
        .where(eq(controlAgents.id, id));

    if (Array.isArray(patch.l7Hosts)) {
      await tx
        .delete(controlAgentL7Hosts)
        .where(eq(controlAgentL7Hosts.agentId, id));
      const hosts = [...new Set(patch.l7Hosts as string[])];
      if (hosts.length > 0)
        await tx
          .insert(controlAgentL7Hosts)
          .values(hosts.map((host) => ({ agentId: id, host })));
    }
  };

  const stop = async (
    id: string,
    opts: { disabled?: boolean; idle?: boolean; stamp?: string } = {},
  ): Promise<{
    agent: ReturnType<typeof parseInfraAgent>;
    stamp: string;
  } | null> => {
    const now = opts.stamp === undefined ? new Date() : new Date(opts.stamp);
    const token = randomUUID();
    const values: Record<string, unknown> = {
      stopRequestedAt: now,
      stopRequestToken: token,
      sessionPinned: false,
      invocationPinned: false,
      invocationPinVersion: sql`${controlAgentSignals.invocationPinVersion} + 1`,
      updatedAt: now,
      ...(opts.disabled === true && { disabledAt: now }),
      ...(opts.disabled === false && { disabledAt: null }),
      ...(opts.idle === true && {
        lastActivityAt: null,
        lastActivityToken: null,
      }),
    };
    const updated = await db
      .update(controlAgentSignals)
      .set(values)
      .where(eq(controlAgentSignals.agentId, id))
      .returning({ agentId: controlAgentSignals.agentId });
    if (updated.length === 0) return null;
    const live = await agentOf(id);
    if (!live) return null;
    return { agent: parseInfraAgent(live), stamp: token };
  };

  const wake = createAgentWake({
    readCached: (id) => cache.get(id),
    readLive,
    isReady: (id) => repo.isReady(id),
    bumpLastActivity: (id) => bumpLastActivity(id),
    whenChanged: (id) => cache.whenChanged(id),
  });

  async function bumpLastActivity(id: string): Promise<void> {
    await db
      .update(controlAgentSignals)
      .set({
        lastActivityAt: new Date(),
        lastActivityToken: randomUUID(),
        updatedAt: new Date(),
      })
      .where(eq(controlAgentSignals.agentId, id));
  }

  const repo: AgentsRepository = {
    async list(owner?) {
      const rows = await readAgentRows(db);
      const all = rows.map((row) => parseInfraAgent(resourceFromRows(row)));
      return owner === undefined
        ? all
        : all.filter((agent) => agent.owner === owner);
    },

    async get(id, owner?) {
      const live = await agentOf(id);
      if (!live) return null;
      const agent = parseInfraAgent(live);
      return owner !== undefined && agent.owner !== owner ? null : agent;
    },

    peekCached(id) {
      const live = cache.peekCached(id);
      return live ? parseInfraAgent(live) : null;
    },

    async create(spec, owner, name, templateId?, annotations?) {
      const id = name;
      const now = new Date();
      const mapped = rowsFromResource(
        {
          metadata: {
            name: id,
            uid: randomUUID(),
            generation: 1,
            creationTimestamp: now.toISOString(),
            labels: {
              "agent-platform.ai/owner": owner,
              ...(templateId !== undefined && {
                "agent-platform.ai/template": templateId,
              }),
            },
            annotations: {
              [LAST_ACTIVITY_KEY]: now.toISOString(),
              ...(annotations ?? {}),
            },
          },
          spec,
        } as KubeObject,
        { cpuLimit: "1", memoryLimit: "2Gi" },
        now.toISOString(),
      );
      if (mapped.refusal !== undefined || mapped.rows === undefined)
        throw new Error(`the Agent cannot become a row: ${mapped.refusal}`);

      const { agent, signals, kit, hosts } = mapped.rows;
      await db.transaction(async (tx) => {
        await tx.insert(controlAgents).values(agent);
        await tx.insert(controlAgentSignals).values(signals);
        if (kit !== null) await tx.insert(controlAgentKitState).values(kit);
        if (hosts.length > 0)
          await tx
            .insert(controlAgentL7Hosts)
            .values(hosts.map((host) => ({ agentId: id, host })));
      });
      await cache.awaitObserved(id, String(agent.generation));
      const created = await agentOf(id);
      if (!created) throw new Error("the Agent was written but cannot be read");
      return parseInfraAgent(created);
    },

    async updateSpec(id, owner, patch) {
      const now = new Date();
      return db.transaction(async (tx) => {
        const row = await ownedRow(tx, id, owner);
        if (!row) return null;
        await applySpec(tx, id, specOf(patch), now);
        await applyAnnotations(
          tx,
          id,
          (patch.annotations as Annotations | undefined) ?? {},
          now,
        );
        const read = await readAgentRows(tx, [id]);
        return read[0] ? parseInfraAgent(resourceFromRows(read[0])) : null;
      });
    },

    async patchSpec(id, patch) {
      await db.transaction(async (tx) => {
        await applySpec(tx, id, specOf(patch), new Date());
      });
    },

    async getLive(id, owner) {
      const live = await readLive(id);
      if (!live) return null;
      const agent = parseInfraAgent(live);
      return owner !== undefined && agent.owner !== owner ? null : agent;
    },

    async writeAgentSpec(id, owner, patch: AgentSpecWrite) {
      const expected = Number(patch.resourceVersion);
      if (!Number.isFinite(expected)) return { ok: false, reason: "conflict" };
      const now = new Date();
      return db.transaction(async (tx): Promise<AgentSpecWriteResult> => {
        const rows = await tx
          .select()
          .from(controlAgents)
          .where(eq(controlAgents.id, id))
          .for("update")
          .limit(1);
        const row = rows[0];
        if (!row) return { ok: false, reason: "not-found" };
        if (owner !== undefined && row.ownerSub !== owner)
          return { ok: false, reason: "not-found" };
        if (row.generation !== expected)
          return { ok: false, reason: "conflict" };
        if (patch.spec !== undefined) await applySpec(tx, id, patch.spec, now);
        await applyAnnotations(tx, id, patch.annotations, now);
        const read = await readAgentRows(tx, [id]);
        return read[0] === undefined
          ? { ok: false, reason: "not-found" }
          : { ok: true, value: parseInfraAgent(resourceFromRows(read[0])) };
      });
    },

    async delete(id, owner?) {
      const deleted = await db
        .delete(controlAgents)
        .where(
          owner === undefined
            ? eq(controlAgents.id, id)
            : and(eq(controlAgents.id, id), eq(controlAgents.ownerSub, owner)),
        )
        .returning({ id: controlAgents.id });
      return deleted.length > 0;
    },

    async restart(id, owner?) {
      const row = await ownedRow(db, id, owner);
      if (!row) return false;
      await db
        .update(controlAgentSignals)
        .set({ rollRev: new Date().toISOString(), updatedAt: new Date() })
        .where(eq(controlAgentSignals.agentId, id));
      return true;
    },

    async wake(id) {
      const now = new Date();
      const woke = await db
        .update(controlAgentSignals)
        .set({
          lastActivityAt: now,
          lastActivityToken: randomUUID(),
          stopRequestedAt: null,
          stopRequestToken: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(controlAgentSignals.agentId, id),
            sql`${controlAgentSignals.disabledAt} IS NULL`,
          ),
        )
        .returning({ agentId: controlAgentSignals.agentId });
      if (woke.length === 0) {
        const existing = await agentOf(id);
        return existing
          ? err({ type: "AgentDisabled" as const })
          : err({ type: "AgentNotFound" as const });
      }
      const live = await readLive(id);
      return live
        ? ok(parseInfraAgent(live))
        : err({ type: "AgentNotFound" as const });
    },

    async setDisabled(id, disabled) {
      const stopped = await stop(id, {
        disabled,
        idle: true,
        ...(disabled ? {} : { stamp: new Date().toISOString() }),
      });
      if (!disabled)
        await db
          .update(controlAgentSignals)
          .set({
            stopRequestedAt: null,
            stopRequestToken: null,
            disabledAt: null,
            updatedAt: new Date(),
          })
          .where(eq(controlAgentSignals.agentId, id));
      return stopped?.agent ?? null;
    },

    async requestStop(id) {
      return (await stop(id))?.agent ?? null;
    },

    async requestSleep(id) {
      const live = await agentOf(id);
      if (!live) return null;
      const parsed = parseInfraAgent(live);
      if (parsed.disabled) return parsed;
      const stopped = await stop(id, { idle: true });
      if (!stopped) return null;
      const { agent: infra, stamp: sleepToken } = stopped;
      void (async () => {
        const settled = await pollUntilReady(
          async () => (await repo.get(id))?.hibernated ?? true,
          {
            initialMs: PAUSE_SETTLE_POLL_MS,
            maxMs: PAUSE_SETTLE_POLL_MS,
            timeoutMs: PAUSE_SETTLE_TIMEOUT_MS,
            wakeOn: () => cache.whenChanged(id),
          },
        );
        if (!settled) {
          getLogger().warn(
            { agentId: id },
            "agent.sleep.settle-timeout — leaving the stop token in place",
          );
          return;
        }
        const cleared = await db
          .update(controlAgentSignals)
          .set({
            stopRequestedAt: null,
            stopRequestToken: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(controlAgentSignals.agentId, id),
              eq(controlAgentSignals.stopRequestToken, sleepToken),
            ),
          )
          .returning({ agentId: controlAgentSignals.agentId });
        if (cleared.length === 0) {
          getLogger().info(
            { agentId: id },
            "agent.sleep.superseded — leaving the newer stop token in place",
          );
          return;
        }
        getLogger().info({ agentId: id }, "agent.sleep.settled");
      })().catch((cause) => {
        getLogger().warn(
          { agentId: id, error: (cause as Error).message },
          "agent.sleep.settle-failed — leaving the stop token in place",
        );
      });
      return infra;
    },

    async isOwnedBy(id, owner) {
      const live = await agentOf(id);
      return live !== null && parseInfraAgent(live).owner === owner;
    },

    async getOwner(id) {
      const live = await agentOf(id);
      return live ? (parseInfraAgent(live).owner ?? null) : null;
    },

    async resolveIdentity(id) {
      const live = await agentOf(id);
      if (!live) return null;
      const agent = parseInfraAgent(live);
      if (!agent.owner) return null;
      const environmentOf = agent.spec.environmentOf;
      return environmentOf !== undefined && environmentOf !== ""
        ? { owner: agent.owner, agentId: id, environmentOf }
        : { owner: agent.owner, agentId: id };
    },

    async patchAnnotation(id, key, value) {
      await db.transaction(async (tx) => {
        await applyAnnotations(tx, id, { [key]: value }, new Date());
      });
    },

    async patchAnnotations(id, annotations) {
      await db.transaction(async (tx) => {
        await applyAnnotations(tx, id, annotations, new Date());
      });
    },

    async setInvocationPin(id) {
      const pinned = await db
        .update(controlAgentSignals)
        .set({
          invocationPinned: true,
          invocationPinVersion: sql`${controlAgentSignals.invocationPinVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(controlAgentSignals.agentId, id),
            sql`${controlAgentSignals.stopRequestedAt} IS NULL`,
          ),
        )
        .returning({
          version: controlAgentSignals.invocationPinVersion,
        });
      return pinned.length > 0;
    },

    async readInvocationPin(id) {
      const rows = await db
        .select({
          pinned: controlAgentSignals.invocationPinned,
          version: controlAgentSignals.invocationPinVersion,
        })
        .from(controlAgentSignals)
        .where(eq(controlAgentSignals.agentId, id))
        .limit(1);
      const row = rows[0];
      return row?.pinned === true ? String(row.version) : null;
    },

    async releaseInvocationPin(id, version) {
      await db
        .update(controlAgentSignals)
        .set({
          invocationPinned: false,
          lastActivityAt: new Date(),
          lastActivityToken: randomUUID(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(controlAgentSignals.agentId, id),
            eq(controlAgentSignals.invocationPinVersion, Number(version)),
          ),
        );
    },

    async listAgentIdsWithAnnotation(key, value) {
      if (key === ANN_ROLL_REV)
        return (
          await db
            .select({ id: controlAgents.id })
            .from(controlAgents)
            .innerJoin(
              controlAgentSignals,
              eq(controlAgentSignals.agentId, controlAgents.id),
            )
            .where(eq(controlAgentSignals.rollRev, value))
        ).map((row) => row.id);
      throw new Error(`the store cannot list Agents by annotation ${key}`);
    },

    async wakeIfHibernated(id) {
      const now = new Date();
      const token = randomUUID();
      const previous = await db.transaction(async (tx) => {
        const rows = await tx
          .select({
            lastActivityAt: controlAgentSignals.lastActivityAt,
            lastActivityToken: controlAgentSignals.lastActivityToken,
          })
          .from(controlAgentSignals)
          .where(eq(controlAgentSignals.agentId, id))
          .for("update")
          .limit(1);
        const row = rows[0];
        if (!row) return null;
        const updated = await tx
          .update(controlAgentSignals)
          .set({
            lastActivityAt: now,
            lastActivityToken: token,
            stopRequestedAt: null,
            stopRequestToken: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(controlAgentSignals.agentId, id),
              sql`${controlAgentSignals.disabledAt} IS NULL`,
            ),
          )
          .returning({ agentId: controlAgentSignals.agentId });
        if (updated.length === 0) return null;
        return row;
      });
      if (previous === null) return null;
      const stamp: AgentActivityStamp = {
        previous: previous.lastActivityToken,
        previousAt: previous.lastActivityAt?.toISOString() ?? null,
        written: token,
      };
      return stamp;
    },

    async wakeUnlessStopped(id) {
      const woke = await db
        .update(controlAgentSignals)
        .set({
          lastActivityAt: new Date(),
          lastActivityToken: randomUUID(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(controlAgentSignals.agentId, id),
            sql`${controlAgentSignals.stopRequestedAt} IS NULL`,
          ),
        )
        .returning({ agentId: controlAgentSignals.agentId });
      return woke.length > 0;
    },

    async restoreActivityIfUnchanged(id, stamp) {
      const previousAt =
        stamp.previousAt === undefined || stamp.previousAt === null
          ? STALE_ACTIVITY
          : new Date(stamp.previousAt);
      await db
        .update(controlAgentSignals)
        .set({
          lastActivityAt: previousAt,
          lastActivityToken: stamp.previous,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(controlAgentSignals.agentId, id),
            sql`${controlAgentSignals.lastActivityToken} IS NOT DISTINCT FROM ${stamp.written}`,
          ),
        );
    },

    async isReady(id) {
      const live = await agentOf(id);
      return live !== null && parseInfraAgent(live).ready;
    },

    ensureReady: wake.ensureReady,
  };

  return repo;
}
