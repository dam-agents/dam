import { TRPCError } from "@trpc/server";

import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";
import type {
  ResolvedStarterKit,
  StarterKit,
  TemplateHarness,
  Agent,
  AgentCreateInput,
  AgentsService,
  ConnectionsService,
  SchedulesService,
  SkillsService,
  StarterKitApplyInput,
  StarterKitApplyResult,
  StarterKitEgressRule,
  StarterKitScheduleOverride,
  StarterKitsService,
  StarterKitView,
} from "api-server-api";
import { resolveKitSchedulePrecheck } from "api-server-api";
import {
  kitInitializationTask,
  describeAccepts,
} from "../domain/onboarding-prompt.js";
import {
  type GrantedTemplate,
  kitRef,
  unmetRequiredConnections,
} from "../domain/requirements.js";
import type { ResolvedKitRow } from "../infrastructure/resolved-catalog-repository.js";
import { emit, EventType } from "../../../events.js";
import { createInputFromSetup } from "../../agents/index.js";
import {
  initializationEvent,
  type RuntimeMutator,
  workspaceCommandEvent,
} from "../../runtime-delivery/index.js";
import type { ReadTemplateSpec } from "../../templates/index.js";
import { createOnboardingMarker } from "./onboarding-marker.js";
import { createKitUpdates, type KitUpdateMarks } from "./kit-updates.js";
import { seedStampAtApply } from "../domain/seed-stamp.js";
import type { KitUpstream } from "../infrastructure/kit-upstream.js";

export type LoadedKit = Omit<ResolvedKitRow, "kitId">;

export interface StarterKitsRepository {
  list(): Promise<LoadedKit[]>;
  get(catalog: string, id: string): Promise<LoadedKit | null>;
}

export interface StarterKitsServiceDeps {
  owner: string;
  repo: StarterKitsRepository;
  agents: Pick<
    AgentsService,
    "create" | "delete" | "get" | "list" | "connectSlack"
  >;
  schedules: Pick<
    SchedulesService,
    "createCron" | "createRRule" | "toggle" | "list"
  >;
  connections: Pick<
    ConnectionsService,
    "listConnections" | "listTemplates" | "getAgentConnections"
  >;
  skills: Pick<SkillsService, "applyEntries">;
  surface: string;
  readTemplateSpec: ReadTemplateSpec;
  wakeAgent: (agentId: string) => Promise<void>;
  markAgentOnboarded: (agentId: string, at: string) => Promise<void>;
  runtimeMutator: Pick<RuntimeMutator, "bump" | "enqueueAfterCommit">;
  egressRules: {
    seed(
      agentId: string,
      rules: readonly StarterKitEgressRule[],
      decidedBy: string,
    ): Promise<void>;
  };
  virtualizationEnabled?: boolean;
  pinnedKit?: string;
  kitUpstream: KitUpstream;
  kitUpdateMarks: KitUpdateMarks;
}

function withSeedStamp(
  seed: ResolvedStarterKit["seed"],
): Pick<AgentCreateInput, "starterKitSeed"> {
  const stamp = seed ? seedStampAtApply(seed) : undefined;
  return stamp ? { starterKitSeed: stamp } : {};
}

function toView(loaded: LoadedKit, pinnedKit: string): StarterKitView {
  return {
    ...loaded.kit,
    catalog: loaded.catalog,
    version: loaded.version,
    source: loaded.source,
    skillsInKit: loaded.skillsInKit,
    pinned: `${loaded.catalog}/${loaded.kit.id}` === pinnedKit,
  };
}

export function createStarterKitsService(
  deps: StarterKitsServiceDeps,
): StarterKitsService {
  async function requireKit(
    catalog: string,
    kitId: string,
  ): Promise<LoadedKit> {
    const loaded = await deps.repo.get(catalog, kitId);
    if (!loaded)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `starter kit not found: ${catalog}/${kitId}`,
      });
    return loaded;
  }

  async function familyTitles(): Promise<ReadonlyMap<string, string>> {
    const templates = await deps.connections.listTemplates();
    return new Map(
      templates.flatMap((t) =>
        t.family ? [[t.family.id, t.family.title] as const] : [],
      ),
    );
  }

  async function grantedTemplates(
    connectionIds: string[],
    onUnknown: "throw" | "skip" = "throw",
  ): Promise<GrantedTemplate[]> {
    if (connectionIds.length === 0) return [];
    const [owned, templates] = await Promise.all([
      deps.connections.listConnections(),
      deps.connections.listTemplates(),
    ]);
    const byId = new Map(owned.map((c) => [c.id, c]));
    const familyOf = new Map(
      templates.flatMap((t) =>
        t.family ? [[t.id, t.family.id] as const] : [],
      ),
    );
    return connectionIds.flatMap((id) => {
      const conn = byId.get(id);
      if (!conn) {
        if (onUnknown === "skip") return [];
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `unknown connection: ${id}`,
        });
      }
      const familyId = familyOf.get(conn.templateId);
      return [
        { templateId: conn.templateId, ...(familyId ? { familyId } : {}) },
      ];
    });
  }

  async function seedSchedules(
    agentId: string,
    loaded: LoadedKit,
    skip: readonly string[],
    overrides: readonly StarterKitScheduleOverride[],
  ): Promise<void> {
    for (const s of loaded.kit.schedules) {
      if (skip.includes(s.name)) continue;
      const o = overrides.find((x) => x.name === s.name);
      const sessionMode = o?.sessionMode ?? s.sessionMode;
      const enabled = o?.enabled ?? s.enabled;
      const precheck = resolveKitSchedulePrecheck(s.precheck, o?.precheck);
      const timing =
        o?.timing ??
        ("cron" in s
          ? { cron: s.cron }
          : { rrule: s.rrule, timezone: s.timezone });

      const created =
        "cron" in timing
          ? await deps.schedules.createCron({
              name: s.name,
              agentId,
              cron: timing.cron,
              task: s.task,
              sessionMode,
              ...(precheck ? { precheck } : {}),
            })
          : await deps.schedules.createRRule({
              name: s.name,
              agentId,
              rrule: timing.rrule,
              timezone: timing.timezone,
              task: s.task,
              sessionMode,
              ...(precheck ? { precheck } : {}),
              ...(o?.quietHours ? { quietHours: o.quietHours } : {}),
            });
      if (!enabled) await deps.schedules.toggle(created.id);
    }
  }

  async function enqueueOnboardingTurn(
    created: Agent,
    loaded: LoadedKit,
    version: string,
    harness: TemplateHarness | undefined,
  ): Promise<void> {
    if (loaded.kit.onboarding === false) return;
    const agentId = created.id;
    const agent = (await deps.agents.get(agentId)) ?? created;
    const [schedules, agentConnections] = await Promise.all([
      deps.schedules.list(agentId),
      deps.connections.getAgentConnections(agentId),
    ]);
    const task = kitInitializationTask(
      {
        kit: loaded.kit,
        catalog: loaded.catalog,
        version,
        granted: await grantedTemplates(
          agentConnections.connections.map((c) => c.connectionId),
          "skip",
        ),
        schedules: schedules.map((s) => ({
          name: s.name,
          enabled: s.spec.enabled,
        })),
        boundChannels: agent.channels.map((c) => c.type),
        familyTitles: await familyTitles(),
      },
      harness,
    );
    if (task === null) return;
    const at = new Date();
    await deps.runtimeMutator.bump(agentId, [
      initializationEvent(agentId, task, at),
    ]);
    await deps.runtimeMutator.enqueueAfterCommit(agentId);
  }

  const runnableHere = (loaded: LoadedKit): boolean =>
    loaded.kit.backend !== "vm" || deps.virtualizationEnabled === true;

  const kitUpdates = createKitUpdates({
    owner: deps.owner,
    repo: deps.repo,
    upstream: deps.kitUpstream,
    marks: deps.kitUpdateMarks,
    agents: deps.agents,
    schedules: deps.schedules,
    grantedTemplates: async (agentId) =>
      grantedTemplates(
        (await deps.connections.getAgentConnections(agentId)).connections.map(
          (c) => c.connectionId,
        ),
        "skip",
      ),
    familyTitles,
    wakeAgent: deps.wakeAgent,
    runtimeMutator: deps.runtimeMutator,
  });

  return {
    ...kitUpdates,

    async list() {
      return (await deps.repo.list())
        .filter(runnableHere)
        .map((loaded) => toView(loaded, deps.pinnedKit ?? ""));
    },

    async get(catalog, id) {
      const loaded = await deps.repo.get(catalog, id);
      return loaded && runnableHere(loaded)
        ? toView(loaded, deps.pinnedKit ?? "")
        : null;
    },

    async apply(input: StarterKitApplyInput): Promise<StarterKitApplyResult> {
      const loaded = await requireKit(input.catalog, input.kitId);
      const { kit, version } = loaded;

      if (!kit.image && !input.templateId)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "this kit brings no agent image; pick a harness",
        });

      const unmet = unmetRequiredConnections(
        kit,
        await grantedTemplates(input.connectionIds),
      );
      if (unmet.length > 0) {
        const titles = await familyTitles();
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `missing required connection: ${unmet
            .map((u) => describeAccepts(u.accepts, titles))
            .join("; ")}`,
        });
      }

      const templateHarness = input.templateId
        ? (await deps.readTemplateSpec(input.templateId))?.spec.harness
        : undefined;
      const kitHarness =
        kit.image || templateHarness ? undefined : kit.harnesses?.[0];
      const harness = kit.image?.harness ?? templateHarness ?? kitHarness;
      const createInput: AgentCreateInput = {
        name: input.name,
        ...(input.avatar ? { avatar: input.avatar } : {}),
        ...(kit.image
          ? { image: kit.image.ref }
          : {
              templateId: input.templateId,
              ...(kitHarness ? { harness: kitHarness } : {}),
            }),
        ...(kit.knowledgeBase
          ? { kbShareRoots: kit.knowledgeBase.shareRoots }
          : {}),
        ...createInputFromSetup(kit),
        ...(kit.egressPreset ? { egressPreset: kit.egressPreset } : {}),
        ...withSeedStamp(kit.seed),
        connectionIds: input.connectionIds,
        ...(kit.hibernationTimeoutMin !== undefined
          ? { hibernationTimeoutMin: kit.hibernationTimeoutMin }
          : {}),
        ...(kit.requireConnectionAddress
          ? { requireConnectionAddress: true }
          : {}),
        starterKit: kitRef(loaded.catalog, kit.id, version),
      };
      const agent = await deps.agents.create(createInput);

      try {
        await deps.egressRules.seed(agent.id, kit.egressRules, deps.owner);
        if (kit.install) {
          await deps.runtimeMutator.bump(agent.id, [
            workspaceCommandEvent(
              "kit-install",
              agent.id,
              kit.install.command,
              new Date(),
            ),
          ]);
          await deps.runtimeMutator.enqueueAfterCommit(agent.id);
        }
        await seedSchedules(
          agent.id,
          loaded,
          input.skipSchedules,
          input.scheduleOverrides,
        );
        if (input.slackChannelId)
          await deps.agents.connectSlack(agent.id, input.slackChannelId, false);
        const briefs =
          kit.onboarding !== false &&
          !(kit.onboarding && "command" in kit.onboarding);
        if (!briefs)
          await deps.markAgentOnboarded(agent.id, new Date().toISOString());
        await enqueueOnboardingTurn(agent, loaded, version, harness);
      } catch (err) {
        await deps.agents.delete(agent.id).catch((cleanupErr: unknown) => {
          getLogger().error(
            { agentId: agent.id, err: cleanupErr },
            "starter kits: apply failed and its agent could not be deleted; it is left behind",
          );
        });
        throw err;
      }
      await deps.wakeAgent(agent.id);
      emit({
        type: EventType.StarterKitApplied,
        agentId: agent.id,
        actorSub: deps.owner,
        surface: deps.surface,
        catalog: loaded.catalog,
        kitId: kit.id,
        version,
      });

      let skills: StarterKitApplyResult["skills"] = null;
      let skillsError: string | null = null;
      if (kit.skills.length > 0) {
        try {
          skills = await deps.skills.applyEntries({
            agentId: agent.id,
            skills: kit.skills,
          });
        } catch (err) {
          skillsError = err instanceof Error ? err.message : String(err);
          securityLog("warn", "starter_kit.skills_failed", {
            category: "resource",
            actor: deps.owner,
            actorKind: "user",
            agentId: agent.id,
            result: "failure",
            reason: skillsError,
          });
        }
      }

      securityLog("info", "starter_kit.apply", {
        category: "resource",
        actor: deps.owner,
        actorKind: "user",
        agentId: agent.id,
        result: "success",
        target: kitRef(loaded.catalog, kit.id, version),
      });
      return { agent, skills, skillsError };
    },

    async markOnboarded(agentId) {
      await createOnboardingMarker(deps)(agentId, deps.owner);
    },
  };
}
