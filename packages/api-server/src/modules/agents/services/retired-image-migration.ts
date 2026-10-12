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
import { executeTemplateUpgrade } from "./agents-service.js";

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

// UNIT_BOUNDARY_DESCRIPTION: whether the platform moves an Agent to the default image without its owner. Only an Agent on one of the retired per-harness images qualifies, found beside the default image in the same registry directory, so a starter-kit workload image or a custom image is never touched. It must also be down, hibernated or over budget, so the image change restarts nothing: a running Agent qualifies once the idle checker hibernates it. A vm Agent is left out because its machine keeps its root across images of one root generation, and a move to another image can start it on an empty root; an Agent with a runtime or storage migration under way is left to finish it first.
export function migratesToDefault(
  agent: InfraAgent,
  defaultImage: string,
): boolean {
  return (
    (agent.hibernated || agent.overBudget) &&
    agent.spec.backend?.type !== "vm" &&
    !agent.runtimeMigration &&
    !agent.storageMigrating &&
    !!agent.spec.image &&
    onRetiredHarnessImage(agent.spec.image, defaultImage)
  );
}

export interface RetiredImageMigration {
  tick(): Promise<void>;
}

// UNIT_BOUNDARY_DESCRIPTION: applies the template upgrade a user would apply from the UI to every Agent migratesToDefault selects, so Agents left on the retired per-harness images stop paying an image unpack on wake. It runs the same upgrade as the UI's Update, so the Agent's harness choice carries over the same way, and it names the default image as the confirmed target, so an Agent whose template does not resolve to the default Template is refused. Eligibility is decided again on a live read, and the spec is written against that read's version: an Agent that woke in between conflicts and is decided again on the next tick.
export function createRetiredImageMigration(deps: {
  listAgents: () => Promise<InfraAgent[]>;
  getAgent: (id: string) => Promise<InfraAgent | null>;
  readTemplateSpec: ReadTemplateSpec;
  writeSpec: (
    id: string,
    write: RuntimeMigrationWrite,
  ) => Promise<RuntimeMigrationWriteResult>;
  log: (message: string) => void;
}): RetiredImageMigration {
  async function migrate(id: string, defaultImage: string): Promise<boolean> {
    let read: InfraAgent | null = null;
    const result = await executeTemplateUpgrade({
      owner: undefined,
      actorKind: "system",
      getAgent: async (agentId) => {
        const live = await deps.getAgent(agentId);
        read = live && migratesToDefault(live, defaultImage) ? live : null;
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
    return result.ok;
  }

  return {
    async tick() {
      const defaultImage = (await deps.readTemplateSpec(DEFAULT_TEMPLATE_ID))
        ?.spec.image;
      if (!defaultImage) return;
      let migrated = 0;
      for (const agent of await deps.listAgents()) {
        if (!migratesToDefault(agent, defaultImage)) continue;
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
