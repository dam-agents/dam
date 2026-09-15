import { TRPCError } from "@trpc/server";
import { securityLog } from "../../../core/security-log.js";
import type {
  Agent,
  AgentCreateInput,
  AgentsService,
  ConnectionsService,
  SchedulesService,
  SkillsService,
  StarterKitApplyInput,
  StarterKitApplyResult,
  StarterKitResources,
  StarterKitScheduleOverride,
  StarterKitsService,
  StarterKitView,
} from "api-server-api";
import {
  composeOnboardingPrompt,
  describeAccepts,
} from "../domain/onboarding-prompt.js";
import {
  type GrantedTemplate,
  kitRef,
  unmetRequiredConnections,
} from "../domain/requirements.js";
import type {
  LoadedKit,
  StarterKitsRepository,
} from "../infrastructure/kits-repository.js";
import type { CreateKnowledgeBaseAgent } from "../../knowledge-bases/index.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { createOnboardingMarker } from "./onboarding-marker.js";

export interface StarterKitsServiceDeps {
  owner: string;
  repo: StarterKitsRepository;
  agents: Pick<AgentsService, "create" | "delete" | "get" | "connectSlack">;
  schedules: Pick<
    SchedulesService,
    "createCron" | "createRRule" | "toggle" | "list"
  >;
  connections: Pick<
    ConnectionsService,
    "listConnections" | "listTemplates" | "getAgentConnections"
  >;
  skills: Pick<SkillsService, "applyEntries">;
  createKnowledgeBaseAgent: CreateKnowledgeBaseAgent;
  wakeAgent: (agentId: string) => Promise<void>;
  markAgentOnboarded: (agentId: string, at: string) => Promise<void>;
  runtimeMutator: Pick<RuntimeMutator, "bump" | "enqueueAfterCommit">;
  now?: () => Date;
}

const ONBOARDING_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function agentShape(
  resources: StarterKitResources | undefined,
): Pick<AgentCreateInput, "size" | "storage"> {
  if (!resources) return {};
  const { cpu, memory, storage } = resources;
  return {
    ...(cpu !== undefined || memory !== undefined
      ? { size: { cpu, memory } }
      : {}),
    ...(storage !== undefined ? { storage } : {}),
  };
}

function toView(loaded: LoadedKit): StarterKitView {
  return {
    ...loaded.kit,
    catalog: loaded.catalog,
    version: loaded.version,
    source: loaded.source,
    skillsInKit: loaded.skillsInKit,
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
            })
          : await deps.schedules.createRRule({
              name: s.name,
              agentId,
              rrule: timing.rrule,
              timezone: timing.timezone,
              task: s.task,
              sessionMode,
              ...(o?.quietHours ? { quietHours: o.quietHours } : {}),
            });
      if (!enabled) await deps.schedules.toggle(created.id);
    }
  }

  async function enqueueOnboardingTurn(
    created: Agent,
    loaded: LoadedKit,
    version: string,
  ): Promise<void> {
    const agentId = created.id;
    const agent = (await deps.agents.get(agentId)) ?? created;
    const [schedules, agentConnections] = await Promise.all([
      deps.schedules.list(agentId),
      deps.connections.getAgentConnections(agentId),
    ]);
    const task = composeOnboardingPrompt({
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
      boundChannels: agent.channels.map(() => "slack"),
      familyTitles: await familyTitles(),
    });
    const at = (deps.now ?? (() => new Date()))();
    await deps.runtimeMutator.bump(agentId, [
      {
        id: `kit-onboarding:${agentId}:${at.getTime()}`,
        kind: "onboarding",
        payload: { task },
        expiresAt: new Date(at.getTime() + ONBOARDING_EVENT_TTL_MS),
      },
    ]);
    await deps.runtimeMutator.enqueueAfterCommit(agentId);
  }

  return {
    async list() {
      return (await deps.repo.list()).map(toView);
    },

    async get(catalog, id) {
      const loaded = await deps.repo.get(catalog, id);
      return loaded ? toView(loaded) : null;
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

      const createInput: AgentCreateInput = {
        name: input.name,
        ...(kit.image
          ? { image: kit.image.ref }
          : { templateId: input.templateId }),
        ...agentShape(kit.resources),
        connectionIds: input.connectionIds,
        ...(kit.env.length > 0 ? { env: kit.env } : {}),
        ...(kit.hibernationTimeoutMin !== undefined
          ? { hibernationTimeoutMin: kit.hibernationTimeoutMin }
          : {}),
        starterKit: kitRef(loaded.catalog, kit.id, version),
      };
      const agent = kit.knowledgeBase
        ? await deps.createKnowledgeBaseAgent(
            createInput,
            kit.knowledgeBase.template,
          )
        : await deps.agents.create(createInput);

      try {
        await seedSchedules(
          agent.id,
          loaded,
          input.skipSchedules,
          input.scheduleOverrides,
        );
        if (input.slackChannelId)
          await deps.agents.connectSlack(agent.id, input.slackChannelId, false);
        await enqueueOnboardingTurn(agent, loaded, version);
      } catch (err) {
        await deps.agents.delete(agent.id).catch(() => {});
        throw err;
      }
      await deps.wakeAgent(agent.id);

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
