import type * as k8s from "@kubernetes/client-node";
import type { AgentsService } from "api-server-api";
import { createK8sClient } from "./infrastructure/k8s.js";
import {
  createAgentsRepository,
  type AgentsRepository,
} from "./infrastructure/agents-repository.js";
import {
  createAgentsService,
  type AgentCleanupHook,
  type PresetSeeder,
} from "./services/agents-service.js";
import type { ReadTemplateSpec } from "../templates/index.js";

export type {
  AgentCleanupHook,
  PresetSeeder,
} from "./services/agents-service.js";

export function composeAgentsModule(deps: {
  api: k8s.CoreV1Api;
  namespace: string;
  owner: string;
  readTemplateSpec: ReadTemplateSpec;
  presetSeeder?: PresetSeeder;
  cleanupHooks?: readonly AgentCleanupHook[];
}): {
  agents: AgentsService;
  repo: AgentsRepository;
} {
  const k8s = createK8sClient(deps.api, deps.namespace);
  const repo = createAgentsRepository(k8s);
  return {
    agents: createAgentsService({
      repo,
      owner: deps.owner,
      readTemplateSpec: deps.readTemplateSpec,
      presetSeeder: deps.presetSeeder,
      cleanupHooks: deps.cleanupHooks,
    }),
    repo,
  };
}
