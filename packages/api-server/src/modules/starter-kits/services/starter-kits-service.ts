import { TRPCError } from "@trpc/server";
import type {
  AgentCreateInput,
  AgentsService,
  ConnectionsService,
  SchedulesService,
  SkillsService,
  StarterKitApplyInput,
  StarterKitApplyResult,
  StarterKitResources,
  StarterKitsService,
  StarterKitView,
} from "api-server-api";
import { securityLog } from "../../../core/security-log.js";
import {
  composeOnboardingPrompt,
  describeAccepts,
} from "../domain/onboarding-prompt.js";
import {
  type GrantedTemplate,
  kitRef,
  parseKitRef,
  unmetRequiredConnections,
} from "../domain/requirements.js";
import type {
  LoadedKit,
  StarterKitsRepository,
} from "../infrastructure/kits-repository.js";

export interface StarterKitsServiceDeps {
  owner: string;
  repo: StarterKitsRepository;
  agents: Pick<AgentsService, "create" | "delete" | "get" | "connectSlack">;
  schedules: Pick<
    SchedulesService,
    "createCron" | "createRRule" | "toggle" | "list"
  >;
  connections: Pick<ConnectionsService, "listConnections" | "listTemplates">;
  skills: Pick<SkillsService, "applyEntries">;
  wakeAgent: (agentId: string) => Promise<void>;
}

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
    return connectionIds.map((id) => {
      const conn = byId.get(id);
      if (!conn)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `unknown connection: ${id}`,
        });
      const familyId = familyOf.get(conn.templateId);
      return { templateId: conn.templateId, ...(familyId ? { familyId } : {}) };
    });
  }

  async function seedSchedules(
    agentId: string,
    loaded: LoadedKit,
    skip: readonly string[],
  ): Promise<void> {
    for (const s of loaded.kit.schedules) {
      if (skip.includes(s.name)) continue;
      const created =
        "cron" in s
          ? await deps.schedules.createCron({
              name: s.name,
              agentId,
              cron: s.cron,
              task: s.task,
              sessionMode: s.sessionMode,
            })
          : await deps.schedules.createRRule({
              name: s.name,
              agentId,
              rrule: s.rrule,
              timezone: s.timezone,
              task: s.task,
              sessionMode: s.sessionMode,
            });
      if (!s.enabled) await deps.schedules.toggle(created.id);
    }
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

      const agent = await deps.agents.create({
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
      });

      try {
        await seedSchedules(agent.id, loaded, input.skipSchedules);
        if (input.slackChannelId)
          await deps.agents.connectSlack(agent.id, input.slackChannelId, false);
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

    async onboardingPrompt(agentId) {
      const agent = await deps.agents.get(agentId);
      if (!agent?.starterKit) return null;
      const ref = parseKitRef(agent.starterKit);
      if (!ref) return null;
      const loaded = await deps.repo.get(ref.catalog, ref.kitId);
      if (!loaded) return null;
      const schedules = await deps.schedules.list(agentId);
      return composeOnboardingPrompt({
        kit: loaded.kit,
        catalog: ref.catalog,
        version: ref.version,
        schedules: schedules.map((s) => ({
          name: s.name,
          enabled: s.spec.enabled,
        })),
        boundChannels: agent.channels.map(() => "slack"),
        familyTitles: await familyTitles(),
      });
    },
  };
}
