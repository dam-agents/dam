import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { Skill, SkillsService } from "api-server-api";
import { createAgentsRepository } from "../agents/infrastructure/agents-repository.js";
import { createInstancesRepository } from "../agents/infrastructure/instances-repository.js";
import { createTemplatesRepository } from "../agents/infrastructure/templates-repository.js";
import { createK8sClient } from "../agents/infrastructure/k8s.js";
import { createAgentRuntimeSkillsClient } from "./infrastructure/agent-runtime-client.js";
import { createAgentTokenResolver } from "./infrastructure/agent-token.js";
import { scanPublicGithubArchive } from "./infrastructure/public-archive-scanner.js";
import { createSkillsRepository } from "./infrastructure/skills-repository.js";
import { createInstanceSkillsRepository } from "./infrastructure/instance-skills-repository.js";
import type { SkillSourceSeed } from "./infrastructure/seed-sources.js";
import { createSkillsService } from "./services/skills-service.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  skills: Skill[];
  expiresAt: number;
}

/**
 * Cache shared across all users, keyed by gitUrl. A skill source returns the
 * same catalogue regardless of who's asking, so there's no owner-scoping.
 * The service is re-composed per request (context-scoped), so the cache must
 * live at module scope to persist across requests.
 */
const sharedScanCache = new Map<string, CacheEntry>();

async function scanWithCache(
  gitUrl: string,
  scanner: (gitUrl: string) => Promise<Skill[]>,
): Promise<Skill[]> {
  const hit = sharedScanCache.get(gitUrl);
  if (hit && hit.expiresAt > Date.now()) {
    process.stderr.write(`[skills] cache hit: ${gitUrl}\n`);
    return hit.skills;
  }
  process.stderr.write(`[skills] cache miss: ${gitUrl}\n`);
  const skills = await scanner(gitUrl);
  sharedScanCache.set(gitUrl, { skills, expiresAt: Date.now() + CACHE_TTL_MS });
  return skills;
}

/** Drop the cached listing for a gitUrl so the next scan hits upstream.
 *  Called on successful publish + manual refresh. */
function invalidateScanCache(gitUrl: string): void {
  if (sharedScanCache.delete(gitUrl)) {
    process.stderr.write(`[skills] cache invalidated: ${gitUrl}\n`);
  }
}

export function composeSkillsModule(
  api: k8s.CoreV1Api,
  namespace: string,
  owner: string,
  db: Db,
  seedSources: SkillSourceSeed[],
): SkillsService {
  const k8s = createK8sClient(api, namespace);
  return createSkillsService({
    repo: createSkillsRepository(db, seedSources),
    instanceSkillsRepo: createInstanceSkillsRepository(db),
    instancesRepo: createInstancesRepository(k8s),
    agentsRepo: createAgentsRepository(k8s),
    templatesRepo: createTemplatesRepository(k8s),
    seedSources,
    runtimeClient: createAgentRuntimeSkillsClient(namespace),
    getAgentToken: createAgentTokenResolver(k8s),
    owner,
    scanSource: scanWithCache,
    invalidateScan: invalidateScanCache,
    scanPublic: scanPublicGithubArchive,
  });
}
