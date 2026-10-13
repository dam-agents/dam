import type { ReadTemplateSpec } from "../../templates/index.js";
import type {
  RuntimeMigrationWrite,
  RuntimeMigrationWriteResult,
} from "../infrastructure/agents-repository.js";
import type { InfraAgent } from "../infrastructure/agent-mappers.js";
import {
  ANN_IMAGE_UPDATE_FROM,
  ANN_IMAGE_UPDATE_REFUSED,
} from "../infrastructure/labels.js";
import {
  resolveEffectiveHibernationTimeoutMin,
  type IdleTimeoutMinutes,
} from "../domain/spec-assembly.js";
import { securityLog } from "../../../core/security-log.js";
import { executeTemplateUpgrade } from "./agents-service.js";

// UNIT_BOUNDARY_DESCRIPTION: how long an always-on Agent must go without activity before it is restarted onto its Template's current image. It stands in for the idle timeout such an Agent does not have, so a user who just stepped away is not restarted under them.
const ALWAYS_ON_QUIET_MS = 60 * 60_000;

export type ImageMove = "now" | "if-pod-idle";

// UNIT_BOUNDARY_DESCRIPTION: whether and when the platform moves an Agent to its Template's current image without its owner. The caller passes that image only for an Agent created from a Template, so an Agent created on an image of its own, a starter kit's included, is never moved. An image this Agent already failed to start on is not tried again. A down Agent, hibernated or over budget, moves now: the image change restarts nothing. A running Agent waits for the idle checker to hibernate it, except an always-on Agent, which never hibernates: it moves once no connection is open, no Invocation pins it, its last activity is older than ALWAYS_ON_QUIET_MS, and its pod reports idle, the same signals the idle checker reads. An Agent with a runtime or storage migration under way is left to finish it first.
export function imageMove(
  agent: InfraAgent,
  templateImage: string,
  idleTimeoutMinutes: IdleTimeoutMinutes,
  now: Date,
): ImageMove | null {
  if (
    agent.runtimeMigration ||
    agent.storageMigrating ||
    !agent.spec.image ||
    agent.spec.image === templateImage ||
    agent.imageUpdateRefused === templateImage
  )
    return null;
  if (agent.hibernated || agent.overBudget) return "now";
  const alwaysOn =
    resolveEffectiveHibernationTimeoutMin(
      agent.spec.hibernationTimeout,
      agent.spec.backend?.type === "vm",
      idleTimeoutMinutes,
    ) === 0;
  const quiet =
    !!agent.quietSince &&
    now.getTime() - agent.quietSince.getTime() >= ALWAYS_ON_QUIET_MS;
  return agent.ready && alwaysOn && quiet && !agent.stopRequested
    ? "if-pod-idle"
    : null;
}

export interface ImageUpdate {
  tick(): Promise<void>;
}

// UNIT_BOUNDARY_DESCRIPTION: keeps every Agent created from a Template on that Template's current image, so a new image reaches existing Agents without their owner. It applies the template upgrade the UI's Update applies to every Agent imageMove selects, so the harness carries over the same way, and names the image it decided on as the confirmed target, so a Template that moved in between refuses it. Eligibility is decided again on a live read, the pod is probed only after that read, and the spec is written against the read's version: a connection, a wake or an activity stamp in between conflicts, and the Agent is decided again on the next tick. The move records the image the Agent came from until the Agent first starts on the new one; a start that fails on the image itself moves it back and records the new image as refused, so no Agent is left on an image it cannot start.
export function createImageUpdate(deps: {
  listAgents: () => Promise<InfraAgent[]>;
  getAgent: (id: string) => Promise<InfraAgent | null>;
  readTemplateSpec: ReadTemplateSpec;
  writeSpec: (
    id: string,
    write: RuntimeMigrationWrite,
  ) => Promise<RuntimeMigrationWriteResult>;
  podIsIdle: (id: string) => Promise<boolean>;
  idleTimeoutMinutes: IdleTimeoutMinutes;
  log: (message: string) => void;
}): ImageUpdate {
  const moveOf = (agent: InfraAgent, templateImage: string) =>
    imageMove(agent, templateImage, deps.idleTimeoutMinutes, new Date());

  async function idlePod(id: string): Promise<boolean> {
    try {
      return await deps.podIsIdle(id);
    } catch {
      return false;
    }
  }

  async function migrate(id: string, templateImage: string): Promise<boolean> {
    let read: InfraAgent | null = null;
    const result = await executeTemplateUpgrade({
      owner: undefined,
      actorKind: "system",
      getAgent: async (agentId) => {
        const live = await deps.getAgent(agentId);
        const move = live && moveOf(live, templateImage);
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
          annotations: {
            [ANN_IMAGE_UPDATE_FROM]: read!.imageUpdateFrom ?? read!.spec.image!,
          },
          resourceVersion: read?.resourceVersion,
        });
        return written.ok ? written.value : null;
      },
    })(id, templateImage);
    if (!result.ok && result.error.type !== "AgentNotFound")
      deps.log(`[image-update] ${id} refused: ${result.error.type}`);
    return result.ok;
  }

  async function settle(id: string): Promise<void> {
    const live = await deps.getAgent(id);
    const from = live?.imageUpdateFrom;
    if (!live || !from || !live.specStart) return;
    const failed = live.specStart === "failed";
    const written = await deps.writeSpec(id, {
      ...(failed ? { spec: { image: from } } : {}),
      annotations: {
        [ANN_IMAGE_UPDATE_FROM]: null,
        ...(failed ? { [ANN_IMAGE_UPDATE_REFUSED]: live.spec.image! } : {}),
      },
      resourceVersion: live.resourceVersion,
    });
    if (!written.ok || !failed) return;
    deps.log(
      `[image-update] ${id} failed to start on ${live.spec.image}; moved back to ${from}`,
    );
    securityLog("info", "agent.upgrade.rollback", {
      category: "resource",
      actor: null,
      actorKind: "system",
      agentId: id,
      result: "success",
      detail: { fromImage: live.spec.image, toImage: from },
    });
  }

  return {
    async tick() {
      const templateImages = new Map<string, string | undefined>();
      const templateImageOf = async (templateId: string) => {
        if (!templateImages.has(templateId))
          templateImages.set(
            templateId,
            (await deps.readTemplateSpec(templateId))?.spec.image,
          );
        return templateImages.get(templateId);
      };
      let migrated = 0;
      for (const agent of await deps.listAgents()) {
        try {
          if (agent.imageUpdateFrom && agent.specStart) {
            await settle(agent.id);
            continue;
          }
          const templateImage =
            agent.templateId && (await templateImageOf(agent.templateId));
          if (!templateImage || !moveOf(agent, templateImage)) continue;
          if (await migrate(agent.id, templateImage)) migrated += 1;
        } catch (e) {
          deps.log(
            `[image-update] ${agent.id} failed: ${e instanceof Error ? e.message : e}`,
          );
        }
      }
      if (migrated > 0)
        deps.log(
          `[image-update] moved ${migrated} agent(s) to their template's image`,
        );
    },
  };
}
