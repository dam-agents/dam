import {
  DEFAULT_TEMPLATE_ID,
  RETIRED_TEMPLATE_HARNESS,
  type ReadTemplateSpec,
} from "../../templates/index.js";
import type {
  RuntimeMigrationWrite,
  RuntimeMigrationWriteResult,
} from "../infrastructure/agents-repository.js";
import type { InfraAgent } from "../infrastructure/agent-mappers.js";
import { resolveEffectiveHibernationTimeoutMin } from "../domain/spec-assembly.js";
import { executeTemplateUpgrade } from "./agents-service.js";

// UNIT_BOUNDARY_DESCRIPTION: how long an always-on Agent must go without activity before it is restarted onto the default image. It stands in for the idle timeout such an Agent does not have, so a user who just stepped away is not restarted under them.
const ALWAYS_ON_QUIET_MS = 60 * 60_000;

export type RetiredImageMove = "now" | "if-pod-idle";

function repositoryOf(image: string): string {
  const name = image.split("@")[0]!;
  const tag = name.lastIndexOf(":");
  return tag > name.lastIndexOf("/") ? name.slice(0, tag) : name;
}

function onRetiredHarnessImage(image: string, defaultImage: string): boolean {
  const defaultRepo = repositoryOf(defaultImage);
  const registryDir = defaultRepo.slice(0, defaultRepo.lastIndexOf("/") + 1);
  return Object.keys(RETIRED_TEMPLATE_HARNESS).some(
    (name) => repositoryOf(image) === registryDir + name,
  );
}

// UNIT_BOUNDARY_DESCRIPTION: whether and when the platform moves an Agent to the default image without its owner. Only an Agent on one of the retired per-harness images qualifies, found beside the default image in the same registry directory, so a starter-kit workload image or a custom image is never touched. A down Agent, hibernated or over budget, moves now: the image change restarts nothing. A running Agent waits for the idle checker to hibernate it, except an always-on Agent, which never hibernates: it moves once no connection is open, no Invocation pins it, its last activity is older than ALWAYS_ON_QUIET_MS, and its pod reports idle, the same signals the idle checker reads. An Agent with a runtime or storage migration under way is left to finish it first.
export function retiredImageMove(
  agent: InfraAgent,
  defaultImage: string,
  globalIdleTimeoutMin: number,
  now: Date,
): RetiredImageMove | null {
  if (
    agent.runtimeMigration ||
    agent.storageMigrating ||
    !agent.spec.image ||
    !onRetiredHarnessImage(agent.spec.image, defaultImage)
  )
    return null;
  if (agent.hibernated || agent.overBudget) return "now";
  const alwaysOn =
    resolveEffectiveHibernationTimeoutMin(
      agent.spec.hibernationTimeout,
      globalIdleTimeoutMin,
    ) === 0;
  const quiet =
    !!agent.quietSince &&
    now.getTime() - agent.quietSince.getTime() >= ALWAYS_ON_QUIET_MS;
  return agent.ready && alwaysOn && quiet && !agent.stopRequested
    ? "if-pod-idle"
    : null;
}

export interface RetiredImageMigration {
  tick(): Promise<void>;
}

// UNIT_BOUNDARY_DESCRIPTION: applies the template upgrade a user would apply from the UI to every Agent retiredImageMove selects, so Agents left on the retired per-harness images stop paying an image unpack on wake. It runs the same upgrade as the UI's Update, so the Agent's harness carries over the same way, and it names the default image as the confirmed target, so an Agent whose template does not resolve to the default Template is refused. Eligibility is decided again on a live read, the pod is probed only after that read, and the spec is written against the read's version: a connection, a wake or an activity stamp in between conflicts, and the Agent is decided again on the next tick.
export function createRetiredImageMigration(deps: {
  listAgents: () => Promise<InfraAgent[]>;
  getAgent: (id: string) => Promise<InfraAgent | null>;
  readTemplateSpec: ReadTemplateSpec;
  writeSpec: (
    id: string,
    write: RuntimeMigrationWrite,
  ) => Promise<RuntimeMigrationWriteResult>;
  podIsIdle: (id: string) => Promise<boolean>;
  globalIdleTimeoutMin: number;
  log: (message: string) => void;
}): RetiredImageMigration {
  const moveOf = (agent: InfraAgent, defaultImage: string) =>
    retiredImageMove(
      agent,
      defaultImage,
      deps.globalIdleTimeoutMin,
      new Date(),
    );

  async function idlePod(id: string): Promise<boolean> {
    try {
      return await deps.podIsIdle(id);
    } catch {
      return false;
    }
  }

  async function migrate(id: string, defaultImage: string): Promise<boolean> {
    let read: InfraAgent | null = null;
    const result = await executeTemplateUpgrade({
      owner: undefined,
      actorKind: "system",
      getAgent: async (agentId) => {
        const live = await deps.getAgent(agentId);
        const move = live && moveOf(live, defaultImage);
        read =
          move === "now" || (move === "if-pod-idle" && (await idlePod(agentId)))
            ? live
            : null;
        return read;
      },
      readTemplateSpec: deps.readTemplateSpec,
      patchSpec: async (agentId, patch) => {
        const written = await deps.writeSpec(agentId, {
          spec: patch,
          annotations: {},
          resourceVersion: read?.resourceVersion,
        });
        return written.ok ? written.value : null;
      },
    })(id, defaultImage);
    if (!result.ok && result.error.type !== "AgentNotFound")
      deps.log(`[retired-image-migration] ${id} refused: ${result.error.type}`);
    return result.ok;
  }

  return {
    async tick() {
      const defaultImage = (await deps.readTemplateSpec(DEFAULT_TEMPLATE_ID))
        ?.spec.image;
      if (!defaultImage) return;
      let migrated = 0;
      for (const agent of await deps.listAgents()) {
        if (!moveOf(agent, defaultImage)) continue;
        try {
          if (await migrate(agent.id, defaultImage)) migrated += 1;
        } catch (e) {
          deps.log(
            `[retired-image-migration] ${agent.id} failed: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
      if (migrated > 0)
        deps.log(
          `[retired-image-migration] moved ${migrated} agent(s) to ${defaultImage}`,
        );
    },
  };
}
