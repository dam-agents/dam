import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { SkillsService } from "api-server-api";
import type { RuntimeProgressPort } from "../agents/index.js";
import {
  createAgentsRepository,
  type AgentsRepository,
} from "../agents/infrastructure/agents-repository.js";
import type { TemplatesRepository } from "../templates/infrastructure/templates-repository.js";
import { createK8sClient } from "../agents/infrastructure/k8s.js";
import { createConnectionsRepository } from "../connections/index.js";
import { createAgentRuntimeSkillsClient } from "./infrastructure/agent-runtime-client.js";
import { createGithubCredentialPort } from "./infrastructure/github-credential-port.js";
import {
  readPublicGithubSkillFile,
  scanPublicGithubArchive,
} from "./infrastructure/public-archive-scanner.js";
import { createScanCache } from "./infrastructure/scan-cache.js";
import { createSkillsRepository } from "./infrastructure/skills-repository.js";
import { createSkillSetsRepository } from "./infrastructure/skill-sets-repository.js";
import { createAgentSkillsRepository } from "./infrastructure/agent-skills-repository.js";
import { createPodPrStateReader } from "./infrastructure/pod-pr-state-reader.js";
import { createGitHubPrStateReader } from "./infrastructure/pr-state-reader.js";
import type { SkillSourceSeed } from "./infrastructure/seed-sources.js";
import { createSkillsService } from "./services/skills-service.js";
import {
  createPrStateResolver,
  type PrStateResolver,
} from "./services/resolve-pr-state.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";
import { createUnitOfWork } from "../../core/unit-of-work.js";

const sharedScanCache = createScanCache();

export function composePrStateResolver(deps: {
  db: Db;
  agents: AgentsRepository;
  namespace: string;
  log: (msg: string) => void;
}): PrStateResolver {
  return createPrStateResolver({
    agentSkills: createAgentSkillsRepository(deps.db),
    reader: createGitHubPrStateReader(),
    podReader: createPodPrStateReader({
      agents: deps.agents,
      runtimeClient: createAgentRuntimeSkillsClient(deps.namespace),
      log: deps.log,
    }),
    log: deps.log,
  });
}

export function composeSkillsModule(deps: {
  api: k8s.CoreV1Api;
  namespace: string;
  owner: string;
  db: Db;
  seedSources: SkillSourceSeed[];
  brandName: string;
  runtimeMutator: RuntimeMutator;
  templatesRepo: TemplatesRepository;
  runtimeProgress: RuntimeProgressPort;
}): SkillsService {
  const { db, namespace, seedSources } = deps;
  const k8sClient = createK8sClient(deps.api, namespace);
  return createSkillsService({
    repo: createSkillsRepository(db, seedSources),
    skillSetsRepo: createSkillSetsRepository(db),
    agentSkillsRepo: createAgentSkillsRepository(db),
    agentsRepo: createAgentsRepository(k8sClient),
    templatesRepo: deps.templatesRepo,
    seedSources,
    runtimeClient: createAgentRuntimeSkillsClient(namespace),
    githubCredential: createGithubCredentialPort(
      createConnectionsRepository(db),
    ),
    runtimeMutator: deps.runtimeMutator,
    runtimeProgress: deps.runtimeProgress,
    unitOfWork: createUnitOfWork(db),
    owner: deps.owner,
    scanSource: sharedScanCache.scan,
    invalidateScan: sharedScanCache.invalidate,
    scanPublic: scanPublicGithubArchive,
    readPublicSkillFile: readPublicGithubSkillFile,
    brandName: deps.brandName,
  });
}
