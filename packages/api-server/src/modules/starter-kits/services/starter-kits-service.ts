import { TRPCError } from "@trpc/server";
import { securityLog } from "../../../core/security-log.js";
import type {
  StarterKit,
  HarnessFamily,
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
  kitInitializationTask,
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
import { emit, EventType } from "../../../events.js";
import {
  initializationEvent,
  type RuntimeMutator,
  workspaceCommandEvent,
} from "../../runtime-delivery/index.js";
import type { ReadTemplateSpec } from "../../templates/index.js";
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
  surface: string;
  readTemplateSpec: ReadTemplateSpec;
  wakeAgent: (agentId: string) => Promise<void>;
  markAgentOnboarded: (agentId: string, at: string) => Promise<void>;
  runtimeMutator: Pick<RuntimeMutator, "bump" | "enqueueAfterCommit">;
  now?: () => Date;
}

const COMMIT_SHA = /^[0-9a-f]{40}$/i;

function withoutSeed(kit: StarterKit): StarterKit {
  const rest = { ...kit };
  delete rest.seed;
  return rest;
}

function seedGitRepo(
  seed: NonNullable<StarterKit["seed"]>,
): NonNullable<AgentCreateInput["gitRepo"]> {
  const declaredCommit =
    seed.ref && COMMIT_SHA.test(seed.ref) ? seed.ref : undefined;
  const commit = seed.commit ?? declaredCommit;
  return {
    url: seed.url,
    into: seed.into,
    ...(commit ? { commit } : {}),
    ...(seed.ref && !declaredCommit ? { branch: seed.ref } : {}),
  };
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
    skillsInKit: loaded.skillsInKit,
  };
}

export function createStarterKitsService(
  deps: StarterKitsServiceDeps,
): StarterKitsService {
  const now = deps.now ?? (() => new Date());
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
  ): Promise<number> {
    let seeded = 0;
    for (const s of loaded.kit.schedules) {
      if (skip.includes(s.name)) continue;
      seeded += 1;
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
    return seeded;
  }

  async function enqueueOnboardingTurn(
    created: Agent,
    loaded: LoadedKit,
    version: string,
    holds: boolean,
    harness: HarnessFamily | undefined,
  ): Promise<void> {
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
        holds,
      },
      harness,
    );
    if (task === null) return;
    const at = now();
    await deps.runtimeMutator.bump(agentId, [
      initializationEvent(agentId, task, at),
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
      const requested = await requireKit(input.catalog, input.kitId);
      if (input.skipSeed && requested.kit.install)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "this kit's install runs from its repository, so the repository cannot be removed",
        });
      const loaded: LoadedKit = input.skipSeed
        ? { ...requested, kit: withoutSeed(requested.kit) }
        : requested;
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

      const harness =
        kit.image?.harness ??
        (input.templateId
          ? (await deps.readTemplateSpec(input.templateId))?.spec.harness
          : undefined);
      const createInput: AgentCreateInput = {
        name: input.name,
        ...(kit.image
          ? { image: kit.image.ref }
          : { templateId: input.templateId }),
        ...(kit.knowledgeBase
          ? { kind: "knowledge-base", kbTemplateId: kit.knowledgeBase.template }
          : {}),
        ...(kit.seed ? { gitRepo: seedGitRepo(kit.seed) } : {}),
        ...agentShape(kit.resources),
        connectionIds: input.connectionIds,
        ...(kit.env.length > 0 ? { env: kit.env } : {}),
        ...(kit.hibernationTimeoutMin !== undefined
          ? { hibernationTimeoutMin: kit.hibernationTimeoutMin }
          : {}),
        starterKit: kitRef(loaded.catalog, kit.id, version),
      };
      const agent = await deps.agents.create(createInput);

      try {
        if (kit.install) {
          await deps.runtimeMutator.bump(agent.id, [
            workspaceCommandEvent(
              "kit-install",
              agent.id,
              kit.install.command,
              now(),
            ),
          ]);
          await deps.runtimeMutator.enqueueAfterCommit(agent.id);
        }
        const seeded = await seedSchedules(
          agent.id,
          loaded,
          input.skipSchedules,
          input.scheduleOverrides,
        );
        if (input.slackChannelId)
          await deps.agents.connectSlack(agent.id, input.slackChannelId, false);
        const holds = kit.onboarding !== false && seeded > 0;
        if (!holds)
          await deps.markAgentOnboarded(agent.id, now().toISOString());
        await enqueueOnboardingTurn(agent, loaded, version, holds, harness);
      } catch (err) {
        await deps.agents.delete(agent.id).catch(() => {});
        throw err;
      }
      await deps.wakeAgent(agent.id);
      if (createInput.kind)
        emit({
          type: EventType.KindedAgentCreated,
          agentId: agent.id,
          actorSub: deps.owner,
          surface: deps.surface,
          kind: createInput.kind,
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
