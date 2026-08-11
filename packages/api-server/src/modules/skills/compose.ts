import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { SkillsService } from "api-server-api";
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

/** The service is re-composed per request (context-scoped), so the cache must
 *  outlive it at module scope to ever hit. */
const sharedScanCache = createScanCache();

/**
 * The pull-request state resolver, composed for background use. Separate from
 * {@link composeSkillsModule} because it is owner-agnostic: the skills service
 * is re-composed per request around one user, while the resolver sweeps every
 * agent's publish records.
 */
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
  /** Whether the pod has applied everything the outbox holds — gates the
   *  `state` reconcile, which would otherwise reap rows mid-apply. */
  isRuntimeSettled: (agentId: string) => Promise<boolean>;
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
    isRuntimeSettled: deps.isRuntimeSettled,
    owner: deps.owner,
    scanSource: sharedScanCache.scan,
    invalidateScan: sharedScanCache.invalidate,
    scanPublic: scanPublicGithubArchive,
    readPublicSkillFile: readPublicGithubSkillFile,
    brandName: deps.brandName,
  });
}
