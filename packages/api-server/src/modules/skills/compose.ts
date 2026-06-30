import type * as k8s from "@kubernetes/client-node";
import type { Db } from "db";
import type { Skill, SkillsService } from "api-server-api";
import { createAgentsRepository } from "../agents/infrastructure/agents-repository.js";
import type { TemplatesRepository } from "../templates/infrastructure/templates-repository.js";
import { createK8sClient } from "../agents/infrastructure/k8s.js";
import { createAgentRuntimeSkillsClient } from "./infrastructure/agent-runtime-client.js";
import { scanPublicGithubArchive } from "./infrastructure/public-archive-scanner.js";
import { createSkillsRepository } from "./infrastructure/skills-repository.js";
import { createAgentSkillsRepository } from "./infrastructure/agent-skills-repository.js";
import type { SkillSourceSeed } from "./infrastructure/seed-sources.js";
import { createSkillsService } from "./services/skills-service.js";
import type { RuntimeMutator } from "../runtime-delivery/index.js";

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  skills: Skill[];
  expiresAt: number;
}

/**
 * Cache shared across all users, keyed by `(gitUrl, path)` — the same repo
 * pointed at different subdirs yields different skills, but the result is
 * independent of who's asking. The service is re-composed per request
 * (context-scoped), so the cache must live at module scope to persist.
 */
const sharedScanCache = new Map<string, CacheEntry>();

function cacheKey(gitUrl: string, path: string | undefined): string {
  // NUL separator can't appear in a URL or a validated path, so the key is
  // collision-proof across (gitUrl, path) pairs.
  return `${gitUrl}\0${path ?? ""}`;
}

async function scanWithCache(
  gitUrl: string,
  path: string | undefined,
  scanner: (gitUrl: string) => Promise<Skill[]>,
): Promise<Skill[]> {
  const key = cacheKey(gitUrl, path);
  const hit = sharedScanCache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    process.stderr.write(`[skills] cache hit: ${key}\n`);
    return hit.skills;
  }
  process.stderr.write(`[skills] cache miss: ${key}\n`);
  const skills = await scanner(gitUrl);
  sharedScanCache.set(key, { skills, expiresAt: Date.now() + CACHE_TTL_MS });
  return skills;
}

/** Drop the cached listing for a `(gitUrl, path)` so the next scan hits
 *  upstream. Called on successful publish + manual refresh. */
function invalidateScanCache(gitUrl: string, path: string | undefined): void {
  const key = cacheKey(gitUrl, path);
  if (sharedScanCache.delete(key)) {
    process.stderr.write(`[skills] cache invalidated: ${key}\n`);
  }
}

export function composeSkillsModule(
  api: k8s.CoreV1Api,
  namespace: string,
  owner: string,
  db: Db,
  seedSources: SkillSourceSeed[],
  brandName: string,
  runtimeMutator: RuntimeMutator,
  templatesRepo: TemplatesRepository,
): SkillsService {
  const k8s = createK8sClient(api, namespace);
  return createSkillsService({
    repo: createSkillsRepository(db, seedSources),
    agentSkillsRepo: createAgentSkillsRepository(db),
    agentsRepo: createAgentsRepository(k8s),
    templatesRepo,
    seedSources,
    runtimeClient: createAgentRuntimeSkillsClient(namespace),
    runtimeMutator,
    owner,
    scanSource: scanWithCache,
    invalidateScan: invalidateScanCache,
    scanPublic: scanPublicGithubArchive,
    brandName,
  });
}
