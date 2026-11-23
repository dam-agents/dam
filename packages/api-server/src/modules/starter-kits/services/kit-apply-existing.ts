import { TRPCError } from "@trpc/server";
import type {
  Agent,
  AgentsService,
  ConnectionsService,
  EnvVar,
  SchedulesService,
  SeedStamp,
  ConnectSlackError,
  StarterKitApplyResult,
  StarterKitApplyToAgentInput,
  StarterKitApplyToAgentResult,
  StarterKitPartKept,
  StarterKitScheduleOverride,
  TemplateHarness,
} from "api-server-api";

import { ChannelType } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { seedGitRepo } from "../../agents/index.js";
import {
  type RuntimeMutator,
  workspaceSeedEvent,
} from "../../runtime-delivery/index.js";
import { describeAccepts } from "../domain/onboarding-prompt.js";
import {
  type GrantedTemplate,
  kitRef,
  unmetRequiredConnections,
} from "../domain/requirements.js";
import { seedStampAtApply } from "../domain/seed-stamp.js";
import type { LoadedKit } from "./starter-kits-service.js";

type KitToApply = Omit<LoadedKit, "publisher">;

export interface KitStamp {
  starterKit: string;
  seed?: SeedStamp;
  kbShareRoots?: string[];
}

export interface KitClaim {
  claim: (agentId: string, starterKit: string) => Promise<boolean>;
  release: (agentId: string, starterKit: string) => Promise<void>;
}

export interface KitApplySteps {
  requireKit: (
    input: Pick<StarterKitApplyToAgentInput, "catalog" | "kitId" | "link">,
  ) => Promise<KitToApply>;
  grantedTemplates: (connectionIds: string[]) => Promise<GrantedTemplate[]>;
  familyTitles: () => Promise<ReadonlyMap<string, string>>;
  queueKitWork: (agentId: string, loaded: KitToApply) => Promise<void>;
  seedSchedules: (
    agentId: string,
    loaded: KitToApply,
    skip: readonly string[],
    overrides: readonly StarterKitScheduleOverride[],
  ) => Promise<void>;
  onboard: (
    agent: Agent,
    loaded: KitToApply,
    harness: TemplateHarness | undefined,
  ) => Promise<void>;
  slackRefusal: (
    reason: ConnectSlackError["type"],
    slackChannelId: string,
  ) => string;
  finishApply: (
    agentId: string,
    loaded: KitToApply,
  ) => Promise<Pick<StarterKitApplyResult, "skills" | "skillsError">>;
}

export interface KitApplyToAgentDeps {
  steps: KitApplySteps;
  agents: Pick<
    AgentsService,
    | "get"
    | "update"
    | "connectSlack"
    | "disconnectSlack"
    | "announceSlackConnect"
  >;
  schedules: Pick<SchedulesService, "list">;
  connections: Pick<
    ConnectionsService,
    "getAgentConnections" | "updateAgentConnections"
  >;
  runtimeMutator: Pick<RuntimeMutator, "bump" | "enqueueAfterCommit">;
  stampKit: (agentId: string, stamp: KitStamp) => Promise<void>;
  kitClaim: KitClaim;
  wakeAgent: (agentId: string) => Promise<void>;
}

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

function partsKept(kit: KitToApply["kit"], agent: Agent): StarterKitPartKept[] {
  const kept: StarterKitPartKept[] = [];
  const storage = kit.resources?.storage;
  if (storage !== undefined && storage !== agent.spec.storageSize)
    kept.push({ part: "storage", kit: storage });
  const harness = agent.spec.harness;
  if (
    kit.harnesses &&
    !(kit.harnesses as readonly string[]).includes(harness ?? "")
  )
    kept.push({ part: "harness", kit: kit.harnesses.join(", ") });
  if (kit.egressPreset)
    kept.push({ part: "egress-preset", kit: kit.egressPreset });
  if (kit.defaultModel)
    kept.push({ part: "default-model", kit: kit.defaultModel });
  return kept;
}

function mergedEnv(
  current: readonly EnvVar[],
  kitEnv: readonly EnvVar[],
): EnvVar[] | null {
  const clashes = kitEnv.filter((v) =>
    current.some((c) => c.name === v.name && c.value !== v.value),
  );
  if (clashes.length > 0)
    conflict(
      `the agent already sets ${clashes.map((v) => v.name).join(", ")} to another value than the kit does; change or remove it on the agent first`,
    );
  const added = kitEnv.filter((v) => !current.some((c) => c.name === v.name));
  return added.length > 0 ? [...current, ...added] : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: applies a Starter Kit to an Agent that already
 * exists, so the user keeps its id, history, files, artifacts and
 * connections. It runs the steps a create from a kit runs, on the Agent, and
 * refuses before it changes anything when the kit cannot apply: the Agent
 * already has a kit, the kit brings its own image, a required connection is
 * missing, or a kit schedule or env variable clashes with one the Agent has.
 * A Slack channel that cannot be bound undoes the bindings this apply made,
 * so a refusal leaves the Agent as it was. The apply first claims the Agent's
 * Kit Version as a compare-and-set, so a second apply racing on the same
 * Agent is refused before it reads or changes anything, and a refusal or
 * failure before the kit is recorded releases the claim. What only a create
 * sets, the Agent keeps, and the result names it.
 */
export function createKitApplyToAgent(deps: KitApplyToAgentDeps) {
  const { steps } = deps;

  async function bindSlackChannels(
    agent: Agent,
    slackChannelIds: readonly string[],
  ): Promise<string[]> {
    const bound = new Set(
      agent.channels.flatMap((c) =>
        c.type === ChannelType.Slack ? [c.slackChannelId] : [],
      ),
    );
    const added: string[] = [];
    for (const slackChannelId of slackChannelIds) {
      if (bound.has(slackChannelId)) continue;
      const connected = await deps.agents.connectSlack(
        agent.id,
        slackChannelId,
        {},
        undefined,
        { quiet: true },
      );
      if (!connected.ok) {
        for (const id of added) await deps.agents.disconnectSlack(agent.id, id);
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `The kit was not applied: ${steps.slackRefusal(connected.error.type, slackChannelId)}`,
        });
      }
      added.push(slackChannelId);
    }
    return added;
  }

  return async function applyToAgent(
    input: StarterKitApplyToAgentInput,
  ): Promise<StarterKitApplyToAgentResult> {
    const found = await deps.agents.get(input.agentId);
    if (!found) throw new TRPCError({ code: "NOT_FOUND" });
    if (found.starterKit)
      conflict(
        `the agent is already set up from the starter kit ${found.starterKit}; take its newer versions with \`dam kit update\``,
      );
    const loaded = await steps.requireKit(input);
    const { kit, version } = loaded;
    if (kit.image)
      conflict(
        `the starter kit runs on its own image (${kit.image.ref}), and an existing agent keeps the image it was created with; create a new agent from the kit instead`,
      );

    const ref = kitRef(loaded.catalog, kit.id, version);
    if (!(await deps.kitClaim.claim(found.id, ref)))
      conflict(
        "another starter kit is being applied to the agent, or it was just set up from one; check it with `dam agent get`",
      );
    let recorded = false;
    try {
      const agent = (await deps.agents.get(found.id)) ?? found;
      const result = await applyClaimed(agent, loaded, input, () => {
        recorded = true;
      });
      return result;
    } catch (err) {
      if (!recorded)
        await deps.kitClaim.release(found.id, ref).catch((cause: unknown) => {
          getLogger().error(
            { agentId: found.id, err: cause },
            "starter kits: an apply to an existing agent failed and its claim could not be released",
          );
        });
      throw err;
    }
  };

  async function applyClaimed(
    agent: Agent,
    loaded: KitToApply,
    input: StarterKitApplyToAgentInput,
    onRecorded: () => void,
  ): Promise<StarterKitApplyToAgentResult> {
    const { kit, version } = loaded;
    const granted = (
      await deps.connections.getAgentConnections(agent.id)
    ).connections.map((c) => c.connectionId);
    const grants = input.connectionIds.filter((id) => !granted.includes(id));
    const unmet = unmetRequiredConnections(
      kit,
      await steps.grantedTemplates([...granted, ...grants]),
    );
    if (unmet.length > 0) {
      const titles = await steps.familyTitles();
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `missing required connection: ${unmet
          .map((u) => describeAccepts(u.accepts, titles))
          .join("; ")}`,
      });
    }

    const existing = new Set(
      (await deps.schedules.list(agent.id)).map((s) => s.name),
    );
    const clashing = kit.schedules
      .filter((s) => !input.skipSchedules.includes(s.name))
      .filter((s) => existing.has(s.name));
    if (clashing.length > 0)
      conflict(
        `the agent already has a schedule named ${clashing.map((s) => s.name).join(", ")}; rename it, or leave the kit's out with --skip-schedule`,
      );
    const env = mergedEnv(agent.spec.env ?? [], kit.env);

    const slackAdded = await bindSlackChannels(
      agent,
      input.slackChannelIds ?? [],
    );

    if (grants.length > 0)
      await deps.connections.updateAgentConnections(agent.id, {
        grant: grants,
        revoke: [],
      });
    if (env !== null || kit.requireConnectionAddress !== undefined)
      await deps.agents.update({
        id: agent.id,
        ...(env !== null ? { env } : {}),
        ...(kit.requireConnectionAddress !== undefined
          ? { requireConnectionAddress: kit.requireConnectionAddress }
          : {}),
      });
    if (kit.seed) {
      await deps.runtimeMutator.bump(agent.id, [
        workspaceSeedEvent(
          "workspace-seed",
          agent.id,
          seedGitRepo(kit.seed),
          new Date(),
        ),
      ]);
      await deps.runtimeMutator.enqueueAfterCommit(agent.id);
    }
    await steps.queueKitWork(agent.id, loaded);
    await steps.seedSchedules(
      agent.id,
      loaded,
      input.skipSchedules,
      input.scheduleOverrides,
    );
    const seedStamp = kit.seed ? seedStampAtApply(kit.seed) : undefined;
    const shareRoots = kit.knowledgeBase?.shareRoots ?? [];
    await deps.stampKit(agent.id, {
      starterKit: kitRef(loaded.catalog, kit.id, version),
      ...(seedStamp ? { seed: seedStamp } : {}),
      ...(shareRoots.length > 0
        ? {
            kbShareRoots: [
              ...new Set([...(agent.kbShareRoots ?? []), ...shareRoots]),
            ],
          }
        : {}),
    });
    onRecorded();
    await steps.onboard(
      agent,
      loaded,
      agent.spec.harness as TemplateHarness | undefined,
    );
    for (const slackChannelId of slackAdded)
      await deps.agents.announceSlackConnect(agent.id, slackChannelId);
    await deps.wakeAgent(agent.id);

    const { skills, skillsError } = await steps.finishApply(agent.id, loaded);
    const applied = (await deps.agents.get(agent.id)) ?? agent;
    return {
      agent: applied,
      skills,
      skillsError,
      kept: partsKept(kit, agent),
    };
  }
}
