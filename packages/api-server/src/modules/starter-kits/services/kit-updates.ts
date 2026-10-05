import { TRPCError } from "@trpc/server";
import type {
  Agent,
  AgentsService,
  KitUpdateChanges,
  KitUpdatePending,
  KitUpdateStatus,
  SchedulesService,
  SeedStamp,
  StarterKitsService,
} from "api-server-api";

import { securityLog } from "../../../core/security-log.js";
import { emit, EventType } from "../../../events.js";
import {
  kitUpdateEvent,
  type RuntimeMutator,
} from "../../runtime-delivery/index.js";
import { composeKitUpdatePrompt } from "../domain/kit-update-prompt.js";
import { type GrantedTemplate, parseKitRef } from "../domain/requirements.js";
import { legacySeedStamp } from "../domain/seed-stamp.js";
import type { KitUpstream } from "../infrastructure/kit-upstream.js";
import type { ResolvedKitRow } from "../infrastructure/resolved-catalog-repository.js";

type LoadedKit = Omit<ResolvedKitRow, "kitId">;

export interface KitUpdateMarks {
  begin(
    agentId: string,
    stamp: SeedStamp,
    pending: KitUpdatePending,
  ): Promise<void>;
  end(agentId: string, stamp: SeedStamp | null): Promise<void>;
  skip(agentId: string, commit: string): Promise<void>;
}

export interface KitUpdatesDeps {
  owner: string;
  repo: { get(catalog: string, id: string): Promise<LoadedKit | null> };
  upstream: KitUpstream;
  marks: KitUpdateMarks;
  agents: Pick<AgentsService, "list" | "get">;
  schedules: Pick<SchedulesService, "list">;
  grantedTemplates: (agentId: string) => Promise<GrantedTemplate[]>;
  familyTitles: () => Promise<ReadonlyMap<string, string>>;
  wakeAgent: (agentId: string) => Promise<void>;
  runtimeMutator: Pick<RuntimeMutator, "bump" | "enqueueAfterCommit">;
  now?: () => Date;
}

type KitUpdateOps = Pick<
  StarterKitsService,
  "updates" | "updateChanges" | "startUpdate" | "skipUpdate"
>;

interface Stamped {
  agent: Agent;
  stamp: SeedStamp;
  current: LoadedKit | null;
}

export function createKitUpdates(deps: KitUpdatesDeps): KitUpdateOps {
  const now = deps.now ?? (() => new Date());

  async function currentKit(agent: Agent): Promise<LoadedKit | null> {
    const ref = agent.starterKit ? parseKitRef(agent.starterKit) : null;
    return ref ? deps.repo.get(ref.catalog, ref.kitId) : null;
  }

  async function stamped(agent: Agent): Promise<Stamped | null> {
    if (!agent.starterKit) return null;
    const current = await currentKit(agent);
    const stamp =
      agent.starterKitSeed ??
      (current ? legacySeedStamp(agent.starterKit, current) : undefined);
    return stamp ? { agent, stamp, current } : null;
  }

  async function statusOf({ agent, stamp }: Stamped): Promise<KitUpdateStatus> {
    const pending = agent.kitUpdatePending ?? null;
    const base = { agentId: agent.id, current: stamp.commit, pending };
    if (!agent.starterKitOnboarded)
      return { ...base, state: "onboarding", latest: null };
    const head = await deps.upstream.head(stamp.url, stamp.branch);
    if (head.status !== "resolved")
      return { ...base, state: "unreachable", latest: null };
    if (pending) return { ...base, state: "pending", latest: head.sha };
    const state =
      head.sha === stamp.commit
        ? "up-to-date"
        : head.sha === agent.kitUpdateSkipped
          ? "skipped"
          : "available";
    return { ...base, state, latest: head.sha };
  }

  async function requireStamped(agentId: string): Promise<Stamped> {
    const agent = await deps.agents.get(agentId);
    if (!agent) throw new TRPCError({ code: "NOT_FOUND" });
    const found = await stamped(agent);
    if (!found)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "this agent has no kit definition to update",
      });
    return found;
  }

  return {
    async updates() {
      const agents = await deps.agents.list();
      const all = await Promise.all(agents.map(stamped));
      return Promise.all(
        all.filter((s): s is Stamped => s !== null).map(statusOf),
      );
    },

    async updateChanges(agentId): Promise<KitUpdateChanges | null> {
      const found = await requireStamped(agentId);
      const status = await statusOf(found);
      const to = status.pending?.targetCommit ?? status.latest;
      if (!to || to === found.stamp.commit) return null;
      return deps.upstream.changes(found.stamp.url, found.stamp.commit, to);
    },

    async startUpdate(agentId) {
      const found = await requireStamped(agentId);
      const status = await statusOf(found);
      if (status.state !== "available" && status.state !== "pending")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `no kit update to start: ${status.state}`,
        });
      const targetCommit = status.latest!;
      const { agent, stamp, current } = found;
      const [granted, schedules, familyTitles] = await Promise.all([
        deps.grantedTemplates(agentId),
        deps.schedules.list(agentId),
        deps.familyTitles(),
      ]);
      const task = composeKitUpdatePrompt({
        stamp,
        targetCommit,
        kit: current?.kit ?? null,
        kitRef: agent.starterKit!,
        granted,
        schedules: schedules.map((s) => ({
          name: s.name,
          enabled: s.spec.enabled,
        })),
        env: agent.spec.env ?? [],
        familyTitles,
      });
      const at = now();
      const pending = { targetCommit, startedAt: at.toISOString() };
      await deps.marks.begin(agentId, stamp, pending);
      await deps.runtimeMutator.bump(agentId, [
        kitUpdateEvent(agentId, task, at),
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(agentId);
      await deps.wakeAgent(agentId);
      emit({ type: EventType.AgentUpdated, agentId, ownerSub: deps.owner });
      securityLog("info", "starter_kit.update_started", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        agentId,
        result: "success",
        target: `${stamp.url}@${targetCommit}`,
      });
      return { ...status, state: "pending", pending };
    },

    async skipUpdate(agentId) {
      const found = await requireStamped(agentId);
      const status = await statusOf(found);
      if (status.state !== "available")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `no kit update to skip: ${status.state}`,
        });
      await deps.marks.skip(agentId, status.latest!);
      emit({ type: EventType.AgentUpdated, agentId, ownerSub: deps.owner });
      return { ...status, state: "skipped" };
    },
  };
}
