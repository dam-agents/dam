import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  CreateSkillSourceInput,
  InstallSkillInput,
  LocalSkill,
  PublishSkillInput,
  PublishSkillResult,
  Skill,
  SkillRef,
  SkillSource,
  SkillsService,
  SkillsState,
  UninstallSkillInput,
} from "api-server-api";
import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import type { InstancesRepository } from "../../agents/infrastructure/instances-repository.js";
import type { TemplatesRepository } from "../../agents/infrastructure/templates-repository.js";
import {
  SkillSourceProtectedError,
  type SkillsRepository,
} from "../infrastructure/skills-repository.js";
import type { InstanceSkillsRepository } from "../infrastructure/instance-skills-repository.js";
import type { SkillSourceSeed } from "../infrastructure/seed-sources.js";
import { seedToSkillSource } from "../infrastructure/seed-sources.js";
import {
  AgentRuntimeUpstreamError,
  type AgentRuntimeSkillsClient,
} from "../infrastructure/agent-runtime-client.js";
import { detectHost } from "../infrastructure/git-host.js";
import { PublicArchiveNotFoundError } from "../infrastructure/public-archive-scanner.js";
import { publishSkill as runPublishSkill } from "./publish-service.js";
import { upstreamToTrpc } from "../infrastructure/upstream-to-trpc.js";

/** Stable, deterministic id for a template-derived source row. The hash
 *  prefix keeps the id compact while avoiding collisions when a template
 *  seeds many sources. */
export function templateSourceId(templateId: string, gitUrl: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(gitUrl)
    .digest("hex")
    .slice(0, 12);
  return `template:${templateId}:${hash}`;
}

export const TEMPLATE_SOURCE_ID_PREFIX = "template:";

const DEFAULT_SKILL_PATHS = ["/home/agent/.agents/skills/"];

export interface SkillsServiceDeps {
  repo: SkillsRepository;
  instanceSkillsRepo: InstanceSkillsRepository;
  instancesRepo: InstancesRepository;
  agentsRepo: AgentsRepository;
  templatesRepo: TemplatesRepository;
  /** System (cluster-admin-declared) Skill Sources, parsed once at api-server
   *  startup from SKILL_SOURCES_SEED. Merged into listSources() with
   *  `system: true` and protected from deletion. */
  seedSources: SkillSourceSeed[];
  runtimeClient: AgentRuntimeSkillsClient;
  getAgentToken: (agentId: string) => Promise<string>;
  owner: string;
  /** Scan via the provided scanner with a shared TTL cache. The cache key is
   *  the gitUrl alone — results are user-independent. */
  scanSource: (
    gitUrl: string,
    scanner: (gitUrl: string) => Promise<Skill[]>,
  ) => Promise<Skill[]>;
  invalidateScan: (gitUrl: string) => void;
  /** Scan a public GitHub repo directly from the api-server pod. Throws
   *  `PublicArchiveNotFoundError` when the archive endpoint returns 404 —
   *  signal to the caller to fall back to the agent-runtime path for
   *  private-repo auth (if the instance is running). */
  scanPublic: (gitUrl: string) => Promise<Skill[]>;
}

/** Resolve the filesystem paths the harness reads skills from, in order of
 *  preference:
 *    1. agent.spec.skillPaths (explicit override, written at creation time)
 *    2. template.spec.skillPaths (source of truth — fallback for agents
 *       created before spec-assembly copied the field through)
 *    3. DEFAULT_SKILL_PATHS (last-resort hardcoded default)
 *
 *  The template fallback is what rescues legacy agents: without it, any
 *  agent ConfigMap written before the spec-assembly fix would silently
 *  install skills into the wrong directory for its harness. */
async function resolveSkillPaths(
  deps: SkillsServiceDeps,
  agentId: string,
): Promise<string[]> {
  const agent = await deps.agentsRepo.get(agentId, deps.owner);
  const agentPaths = agent?.spec.skillPaths;
  if (agentPaths && agentPaths.length > 0) return agentPaths;

  if (agent?.templateId) {
    const template = await deps.templatesRepo.get(agent.templateId);
    const tmplPaths = template?.spec.skillPaths;
    if (tmplPaths && tmplPaths.length > 0) return tmplPaths;
  }

  return DEFAULT_SKILL_PATHS;
}

async function loadRunningInstance(
  deps: SkillsServiceDeps,
  instanceId: string,
) {
  const infra = await deps.instancesRepo.get(instanceId, deps.owner);
  if (!infra)
    throw new TRPCError({ code: "NOT_FOUND", message: "instance not found" });
  if (infra.currentState !== "running") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `instance is ${infra.currentState ?? "not running"}; wake it before installing skills`,
    });
  }
  return infra;
}

/**
 * canPublish is a soft signal: "the publish infrastructure knows how to
 * target this host." True when the gitUrl parses as a GitHub URL — that's
 * the only host our publish flow supports today. Authentication/authorization
 * (is the user Connected in OneCLI? is this agent granted access?) is not
 * preflighted here; any failure surfaces at publish time with a precise CTA
 * from OneCLI's gateway. Cheaper + harder to get stale than a cluster call.
 */
function enrichSources(sources: SkillSource[]): SkillSource[] {
  return sources.map((s) =>
    detectHost(s.gitUrl) ? { ...s, canPublish: true } : s,
  );
}

/** Build the list of template-derived sources for an instance. Resolves the
 *  instance → agent → template chain and synthesises a SkillSource per entry
 *  in template.spec.skillSources. Returns an empty list if any link in the
 *  chain is missing — template sources are a nice-to-have overlay, never a
 *  hard dependency. */
async function loadTemplateSources(
  deps: SkillsServiceDeps,
  instanceId: string,
): Promise<SkillSource[]> {
  const instance = await deps.instancesRepo.get(instanceId, deps.owner);
  if (!instance) return [];
  const agent = await deps.agentsRepo.get(instance.agentId, deps.owner);
  if (!agent?.templateId) return [];
  const template = await deps.templatesRepo.get(agent.templateId);
  if (!template?.spec.skillSources?.length) return [];
  return template.spec.skillSources.map((seed) => ({
    id: templateSourceId(template.id, seed.gitUrl),
    name: seed.name,
    gitUrl: seed.gitUrl,
    fromTemplate: { templateId: template.id, templateName: template.name },
  }));
}

/** Resolve a template-synthesised id back to a SkillSource by parsing the
 *  templateId out of the id and finding the seed whose gitUrl hashes to the
 *  embedded suffix. Returns null if the template is gone or the entry was
 *  removed. */
async function resolveTemplateSource(
  deps: SkillsServiceDeps,
  id: string,
): Promise<SkillSource | null> {
  const parts = id.split(":");
  if (parts.length !== 3 || parts[0] !== "template") return null;
  const [, templateId, hash] = parts;
  const template = await deps.templatesRepo.get(templateId);
  if (!template?.spec.skillSources?.length) return null;
  const seed = template.spec.skillSources.find((s) =>
    templateSourceId(templateId, s.gitUrl).endsWith(`:${hash}`),
  );
  if (!seed) return null;
  return {
    id,
    name: seed.name,
    gitUrl: seed.gitUrl,
    fromTemplate: { templateId: template.id, templateName: template.name },
  };
}

/** Look up any source by id — template-synthesised, system seed, or a real
 *  user-owned Postgres row. Each kind has its own resolution path; we
 *  dispatch on id shape (for templates) and seed-id presence (for system
 *  sources) to avoid querying the wrong store. */
async function resolveSource(
  deps: SkillsServiceDeps,
  id: string,
): Promise<SkillSource | null> {
  if (id.startsWith(TEMPLATE_SOURCE_ID_PREFIX)) {
    return resolveTemplateSource(deps, id);
  }
  const seed = deps.seedSources.find((s) => s.id === id);
  if (seed) return seedToSkillSource(seed);
  return deps.repo.get(id, deps.owner);
}

/** Order the merged source list: user → template → platform. "Yours first"
 *  matches ownership + recency (what the user most recently added is most
 *  top-of-mind); template is second because it's scoped to this instance's
 *  agent; platform is last because it's cluster-wide and least personal.
 *  Within-kind ordering is case-insensitive alphabetical by name — stable
 *  across reloads. */
function sortSources(list: SkillSource[]): SkillSource[] {
  const kindOf = (s: SkillSource): number => {
    if (s.system) return 2;
    if (s.fromTemplate) return 1;
    return 0;
  };
  return [...list].sort((a, b) => {
    const ka = kindOf(a);
    const kb = kindOf(b);
    if (ka !== kb) return ka - kb;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

/** Dedupe a [user, system, template]-ordered list by gitUrl: whichever
 *  entry appears first wins, which makes "user shadows system shadows
 *  template" fall out naturally. */
function dedupeByGitUrl(list: SkillSource[]): SkillSource[] {
  const seen = new Set<string>();
  const out: SkillSource[] = [];
  for (const s of list) {
    if (seen.has(s.gitUrl)) continue;
    seen.add(s.gitUrl);
    out.push(s);
  }
  return out;
}

function upsertSkillRef(current: SkillRef[], next: SkillRef): SkillRef[] {
  const filtered = current.filter(
    (s) => !(s.source === next.source && s.name === next.name),
  );
  return [...filtered, next];
}

function removeSkillRef(
  current: SkillRef[],
  key: { source: string; name: string },
): SkillRef[] {
  return current.filter(
    (s) => !(s.source === key.source && s.name === key.name),
  );
}

export function createSkillsService(deps: SkillsServiceDeps): SkillsService {
  return {
    async listSources(instanceId?: string) {
      const [owned, template] = await Promise.all([
        deps.repo.list(deps.owner),
        instanceId
          ? loadTemplateSources(deps, instanceId)
          : Promise.resolve<SkillSource[]>([]),
      ]);
      const seeds = deps.seedSources.map(seedToSkillSource);
      // Priority order matters for dedupe: user-created first, then
      // platform-seeded, then template-derived. A user source with the same
      // URL as a system or template entry wins — if they later remove the
      // system/template layer, their copy is still there.
      const merged = dedupeByGitUrl([...owned, ...seeds, ...template]);
      return sortSources(enrichSources(merged));
    },
    async getSource(id) {
      const s = await resolveSource(deps, id);
      if (!s) return null;
      const [enriched] = enrichSources([s]);
      return enriched;
    },
    createSource: (input: CreateSkillSourceInput) =>
      deps.repo.create(input, deps.owner),
    async deleteSource(id) {
      // Template-derived ids are synthesised at read time — there's no row
      // to delete. Reject up-front with the same FORBIDDEN code the UI uses
      // for system sources so the error shape matches.
      if (id.startsWith(TEMPLATE_SOURCE_ID_PREFIX)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "skill source is declared by an agent template and cannot be deleted",
        });
      }
      // Capture the gitUrl before deletion — after delete we can't resolve
      // which installed-skill entries belonged to this source.
      const src = await resolveSource(deps, id);
      try {
        await deps.repo.delete(id, deps.owner);
      } catch (err) {
        if (err instanceof SkillSourceProtectedError) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw err;
      }
      // Scrub installed-skill entries that reference the now-gone source URL
      // across every instance owned by the user. Without this, re-adding a
      // source with the same URL would render its skills as already-checked
      // (the stale rows persist), which is confusing at best and wrong when
      // the user has manually deleted the skill files in the meantime.
      if (src) {
        const instances = await deps.instancesRepo.list(deps.owner);
        await deps.instanceSkillsRepo.removeBySource(
          instances.map((i) => i.id),
          src.gitUrl,
        );
      }
    },

    async listSkills(sourceId: string, instanceId?: string) {
      const src = await resolveSource(deps, sourceId);
      if (!src) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `skill source ${JSON.stringify(sourceId)} not found`,
        });
      }

      // Fast path: public GitHub repo scanned directly from api-server. This
      // works in every OneCLI state (unconfigured, not Connected, not
      // granted, fully granted) because api-server has direct internet
      // egress — it never touches OneCLI's per-agent-grant gating.
      if (detectHost(src.gitUrl)) {
        try {
          return await deps.scanSource(src.gitUrl, deps.scanPublic);
        } catch (err) {
          if (!(err instanceof PublicArchiveNotFoundError)) throw err;
          // 404 → repo is private (or nonexistent). Only the authenticated
          // agent-runtime path can distinguish those and surface a useful
          // CTA, so we fall through.
        }
      }

      // Private/authenticated path: delegate to agent-runtime inside a
      // running instance pod, which uses OneCLI's token swap. Without an
      // instanceId we can't target a pod — refuse with a clear message.
      if (!instanceId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "source is private; select an instance to scan it",
        });
      }
      const infra = await deps.instancesRepo.get(instanceId, deps.owner);
      if (!infra)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "instance not found",
        });
      if (infra.currentState !== "running") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `instance is ${infra.currentState ?? "not running"}; start it before browsing private sources`,
        });
      }
      const token = await deps.getAgentToken(infra.agentId);
      try {
        return await deps.scanSource(src.gitUrl, (gitUrl) =>
          deps.runtimeClient.scan(instanceId, token, gitUrl),
        );
      } catch (err) {
        if (err instanceof AgentRuntimeUpstreamError) throw upstreamToTrpc(err);
        throw err;
      }
    },

    async installSkill(input: InstallSkillInput) {
      const infra = await loadRunningInstance(deps, input.instanceId);
      const skillPaths = await resolveSkillPaths(deps, infra.agentId);
      const token = await deps.getAgentToken(infra.agentId);

      let result;
      try {
        result = await deps.runtimeClient.install(input.instanceId, token, {
          source: input.source,
          name: input.name,
          version: input.version,
          skillPaths,
        });
      } catch (err) {
        if (err instanceof AgentRuntimeUpstreamError) throw upstreamToTrpc(err);
        throw err;
      }

      // Prefer the scan-time contentHash carried by the UI (stable snapshot
      // of what the user *intended* to install). Fall back to the hash the
      // agent-runtime returned for MCP-initiated installs that skip the
      // scan round-trip.
      const contentHash = input.contentHash ?? result.contentHash;
      const ref: SkillRef = {
        source: input.source,
        name: input.name,
        version: input.version,
        contentHash,
      };
      await deps.instanceSkillsRepo.upsertSkill(input.instanceId, ref);
      const current = await deps.instanceSkillsRepo.listSkills(
        input.instanceId,
      );
      return upsertSkillRef(
        current.filter(
          (s) => !(s.source === ref.source && s.name === ref.name),
        ),
        ref,
      );
    },

    async uninstallSkill(input: UninstallSkillInput) {
      const infra = await loadRunningInstance(deps, input.instanceId);
      const skillPaths = await resolveSkillPaths(deps, infra.agentId);
      const token = await deps.getAgentToken(infra.agentId);

      await deps.runtimeClient.uninstall(input.instanceId, token, {
        name: input.name,
        skillPaths,
      });

      await deps.instanceSkillsRepo.removeSkill(input.instanceId, {
        source: input.source,
        name: input.name,
      });
      const current = await deps.instanceSkillsRepo.listSkills(
        input.instanceId,
      );
      return removeSkillRef(current, {
        source: input.source,
        name: input.name,
      });
    },

    async publishSkill(input: PublishSkillInput): Promise<PublishSkillResult> {
      const result = await runPublishSkill(
        {
          owner: deps.owner,
          resolveSource: (id) => resolveSource(deps, id),
          instances: deps.instancesRepo,
          instanceSkills: deps.instanceSkillsRepo,
          agents: deps.agentsRepo,
          runtimeClient: deps.runtimeClient,
          getAgentToken: deps.getAgentToken,
        },
        input,
      );
      // Drop the scan cache for this source so the next listSkills reflects
      // the merged PR (whenever that happens — we don't wait, we just stop
      // serving a stale snapshot).
      const source = await resolveSource(deps, input.sourceId);
      if (source) deps.invalidateScan(source.gitUrl);
      return result;
    },

    async refreshSource(id: string): Promise<void> {
      const source = await resolveSource(deps, id);
      if (!source)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "skill source not found",
        });
      deps.invalidateScan(source.gitUrl);
    },

    async listLocal(instanceId: string): Promise<LocalSkill[]> {
      const infra = await deps.instancesRepo.get(instanceId, deps.owner);
      if (!infra) return [];
      // No filesystem to read when the pod isn't running.
      if (infra.currentState !== "running") return [];
      const skillPaths = await resolveSkillPaths(deps, infra.agentId);
      const token = await deps.getAgentToken(infra.agentId);
      const all = await deps.runtimeClient.listLocal(
        instanceId,
        token,
        skillPaths,
      );
      // Subtract anything already tracked as installed-from-remote (by directory
      // name). Matches behavior that the remote-installed entry is the canonical
      // one when names collide.
      const tracked = new Set(
        (await deps.instanceSkillsRepo.listSkills(instanceId)).map(
          (s) => s.name,
        ),
      );
      return all.filter((s) => !tracked.has(s.name));
    },

    /**
     * Reconciled skills view. Returns:
     *   - installed: SkillRefs whose directories still exist on the pod
     *   - standalone: on-disk skills that aren't tracked
     *
     * Also self-heals tracked installs: when an entry's directory is missing
     * (manual deletion, PVC wipe, etc.) it's dropped from Postgres. Safe
     * because the filesystem is the source of truth for "what is installed";
     * the DB row is the declarative record that just needs to catch up.
     *
     * When the pod isn't running we can't see the filesystem, so we return
     * the tracked refs as-is (no reconciliation) and an empty standalone
     * list. This avoids wrongly dropping rows during a restart.
     */
    async getState(instanceId: string): Promise<SkillsState> {
      const infra = await deps.instancesRepo.get(instanceId, deps.owner);
      if (!infra)
        return { installed: [], standalone: [], instancePublishes: [] };
      if (infra.currentState !== "running") {
        const [installed, instancePublishes] = await Promise.all([
          deps.instanceSkillsRepo.listSkills(instanceId),
          deps.instanceSkillsRepo.listPublishes(instanceId),
        ]);
        return { installed, standalone: [], instancePublishes };
      }

      const skillPaths = await resolveSkillPaths(deps, infra.agentId);
      const token = await deps.getAgentToken(infra.agentId);
      const local = await deps.runtimeClient.listLocal(
        instanceId,
        token,
        skillPaths,
      );

      const onDisk = new Set(local.map((s) => s.name));

      // Drop ghost rows whose directories no longer exist. Reconcile only
      // performs a write when something needs evicting.
      await deps.instanceSkillsRepo.reconcile(instanceId, onDisk);

      const [installed, instancePublishes] = await Promise.all([
        deps.instanceSkillsRepo.listSkills(instanceId),
        deps.instanceSkillsRepo.listPublishes(instanceId),
      ]);

      const trackedNames = new Set(installed.map((s) => s.name));
      const standalone = local.filter((s) => !trackedNames.has(s.name));
      return { installed, standalone, instancePublishes };
    },
  };
}
