import crypto from "node:crypto";
import { TRPCError } from "@trpc/server";
import type {
  LocalSkill,
  Skill,
  SkillCreateLocalInput,
  SkillCreateSourceInput,
  SkillDeleteLocalInput,
  SkillInstallInput,
  SkillLocalFiles,
  SkillPublishInput,
  SkillPublishResult,
  SkillReadLocalInput,
  SkillRef,
  SkillSource,
  SkillsService,
  SkillsState,
  SkillUninstallInput,
  SkillApplyBatchInput,
  SkillSetEntry,
  SkillSetSkipReason,
} from "api-server-api";
import { MAX_SKILL_BATCH_ENTRIES, skillKey } from "api-server-api";
import type { RuntimeSettledPort } from "../../agents/index.js";
import type { AgentsRepository } from "../../agents/infrastructure/agents-repository.js";
import { computeAgentState } from "../../agents/infrastructure/agent-mappers.js";
import type { TemplatesRepository } from "../../templates/infrastructure/templates-repository.js";
import {
  SkillSourceProtectedError,
  type SkillsRepository,
} from "../infrastructure/skills-repository.js";
import type { AgentSkillsRepository } from "../infrastructure/agent-skills-repository.js";
import type { SkillSetsRepository } from "../infrastructure/skill-sets-repository.js";
import type { SkillSourceSeed } from "../infrastructure/seed-sources.js";
import { seedToSkillSource } from "../infrastructure/seed-sources.js";
import { securityLog } from "../../../core/security-log.js";
import { isUniqueViolation } from "../../../core/db-errors.js";
import {
  AgentRuntimeClientError,
  AgentRuntimeConflictError,
  type AgentRuntimeSkillsClient,
} from "../infrastructure/agent-runtime-client.js";
import type { RuntimeMutator } from "../../runtime-delivery/index.js";
import { detectHost } from "../domain/git-host.js";
import { PublicArchiveNotFoundError } from "../infrastructure/public-archive-scanner.js";
import type { ScanScope } from "../infrastructure/scan-cache.js";
import { publishSkill as runPublishSkill } from "./publish-service.js";
import { ensureAgentReachable } from "./ensure-agent-reachable.js";
import {
  hasScanFailure,
  privateScanFailure,
  scanFailureError,
  scanFailureToTrpc,
} from "../infrastructure/upstream-to-trpc.js";
import type { GithubCredentialPort } from "../infrastructure/github-credential-port.js";
import { getLogger } from "../../../core/logger.js";

export function templateSourceId(templateId: string, gitUrl: string): string {
  const hash = crypto
    .createHash("sha256")
    .update(gitUrl)
    .digest("hex")
    .slice(0, 12);
  return `template:${templateId}:${hash}`;
}

export const TEMPLATE_SOURCE_ID_PREFIX = "template:";

export interface SkillsServiceDeps {
  repo: SkillsRepository;
  skillSetsRepo: SkillSetsRepository;
  agentSkillsRepo: AgentSkillsRepository;
  agentsRepo: AgentsRepository;
  templatesRepo: TemplatesRepository;
  seedSources: SkillSourceSeed[];
  runtimeClient: AgentRuntimeSkillsClient;
  githubCredential: GithubCredentialPort;
  runtimeMutator: RuntimeMutator;
  runtimeSettled: RuntimeSettledPort;
  owner: string;
  scanSource: (
    scope: ScanScope,
    gitUrl: string,
    path: string | undefined,
    scanner: (gitUrl: string) => Promise<Skill[]>,
  ) => Promise<{ skills: Skill[]; scannedAt: number }>;
  invalidateScan: (gitUrl: string, path: string | undefined) => void;
  scanPublic: (gitUrl: string, path?: string) => Promise<Skill[]>;
  readPublicSkillFile: (
    gitUrl: string,
    version: string,
    dir: string,
  ) => Promise<string>;
  brandName: string;
}

function enrichSources(sources: SkillSource[]): SkillSource[] {
  return sources.map((s) =>
    detectHost(s.gitUrl) ? { ...s, canPublish: true } : s,
  );
}

async function loadTemplateSources(
  deps: SkillsServiceDeps,
  agentId: string,
): Promise<SkillSource[]> {
  const instance = await deps.agentsRepo.get(agentId, deps.owner);
  if (!instance) return [];
  const agent = await deps.agentsRepo.get(instance.id, deps.owner);
  if (!agent?.templateId) return [];
  const template = await deps.templatesRepo.get(agent.templateId);
  if (!template?.spec.skillSources?.length) return [];
  return template.spec.skillSources.map((seed) => ({
    id: templateSourceId(template.id, seed.gitUrl),
    name: seed.name,
    gitUrl: seed.gitUrl,
    ...(seed.path !== undefined ? { path: seed.path } : {}),
    fromTemplate: { templateId: template.id, templateName: template.name },
  }));
}

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
    ...(seed.path !== undefined ? { path: seed.path } : {}),
    fromTemplate: { templateId: template.id, templateName: template.name },
  };
}

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

async function sourcePathsByGitUrl(
  deps: SkillsServiceDeps,
  agentId: string,
): Promise<Map<string, string | undefined>> {
  const [owned, template] = await Promise.all([
    deps.repo.list(deps.owner),
    loadTemplateSources(deps, agentId),
  ]);
  const seeds = deps.seedSources.map(seedToSkillSource);
  const merged = dedupeByGitUrl([...owned, ...seeds, ...template]);
  return new Map(merged.map((s) => [s.gitUrl, s.path]));
}

async function resolveSourcePathByGitUrl(
  deps: SkillsServiceDeps,
  agentId: string,
  gitUrl: string,
): Promise<string | undefined> {
  return (await sourcePathsByGitUrl(deps, agentId)).get(gitUrl);
}

function asPodVerdict(err: unknown): unknown {
  if (err instanceof AgentRuntimeClientError) {
    return new TRPCError({ code: err.code, message: err.podMessage });
  }
  return err;
}

async function standaloneFor(
  deps: SkillsServiceDeps,
  agentId: string,
  tracked: SkillRef[],
): Promise<LocalSkill[]> {
  const all = await deps.runtimeClient.listLocal(agentId);
  const trackedNames = new Set(tracked.map((s) => s.name));
  return all.filter((s) => !trackedNames.has(s.name));
}

interface SourceScan {
  skills: Skill[];
  scannedAt: number;
  viaPod: boolean;
  visibility?: "public" | "private";
}

async function scanForSource(
  deps: SkillsServiceDeps,
  src: SkillSource,
  agentId?: string,
): Promise<SourceScan> {
  try {
    return await runScanForSource(deps, src, agentId);
  } catch (err) {
    if (hasScanFailure(err)) throw err;
    getLogger().error(
      { err, source: src.gitUrl, path: src.path, agentId },
      "skills scan: unclassified failure",
    );
    throw scanFailureError("other");
  }
}

async function unreachableSandboxCopy(
  deps: SkillsServiceDeps,
  agentId: string,
): Promise<{ title: string; detail: string } | undefined> {
  const infra = await deps.agentsRepo.get(agentId, deps.owner);
  switch (infra ? computeAgentState(infra) : undefined) {
    case "hibernated":
      return {
        title: "This sandbox isn't running",
        detail: "Start the sandbox, then re-scan to list this source's skills.",
      };
    case "error":
    case "over_budget":
      return {
        title: "This sandbox can't be started",
        detail:
          "Open the sandbox to see why, then re-scan to list this source's skills.",
      };
    default:
      return undefined;
  }
}

async function podGithubVerdict(
  deps: SkillsServiceDeps,
  err: unknown,
  agentId: string,
): Promise<TRPCError | null> {
  const failure = privateScanFailure(err);
  if (!failure) return null;
  if (
    failure.code === "repo_unreachable" &&
    !(await deps.githubCredential.hasGithubApiCredential(agentId))
  ) {
    return scanFailureError("needs_github_connection");
  }
  return scanFailureToTrpc(failure);
}

async function runScanForSource(
  deps: SkillsServiceDeps,
  src: SkillSource,
  agentId?: string,
): Promise<SourceScan> {
  let archiveAsked = false;
  if (detectHost(src.gitUrl)) {
    archiveAsked = true;
    try {
      const { skills, scannedAt } = await deps.scanSource(
        { kind: "shared" },
        src.gitUrl,
        src.path,
        (gitUrl) => deps.scanPublic(gitUrl, src.path),
      );
      return { skills, scannedAt, viaPod: false, visibility: "public" };
    } catch (err) {
      if (!(err instanceof PublicArchiveNotFoundError)) throw err;
    }
  }

  if (!agentId) {
    throw scanFailureError("needs_sandbox");
  }
  try {
    await ensureAgentReachable(deps.agentsRepo, agentId, deps.owner);
  } catch (err) {
    getLogger().warn(
      { err, source: src.gitUrl, agentId },
      "skills scan: sandbox unreachable",
    );
    throw scanFailureError(
      "agent_unreachable",
      await unreachableSandboxCopy(deps, agentId),
    );
  }
  try {
    const { skills, scannedAt } = await deps.scanSource(
      { kind: "agent", owner: deps.owner, agentId },
      src.gitUrl,
      src.path,
      (gitUrl) => deps.runtimeClient.scan(agentId, gitUrl, src.path),
    );
    return {
      skills,
      scannedAt,
      viaPod: true,
      visibility: archiveAsked ? "private" : undefined,
    };
  } catch (err) {
    const verdict = await podGithubVerdict(deps, err, agentId);
    if (!verdict) throw err;
    throw verdict;
  }
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
  const applyBatchWith = async (
    input: SkillApplyBatchInput,
    sourcePaths?: ReadonlyMap<string, string | undefined>,
  ): Promise<SkillRef[]> => {
    const { agentId, install, uninstall } = input;

    if (install.length === 0 && uninstall.length === 0) {
      if (!(await deps.agentsRepo.get(agentId, deps.owner))) {
        throw new TRPCError({ code: "NOT_FOUND", message: "agent not found" });
      }
      return deps.agentSkillsRepo.listSkills(agentId);
    }

    const removing = new Set(uninstall.map(skillKey));
    const contradiction = install.find((e) => removing.has(skillKey(e)));
    if (contradiction) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `skill is in both install and uninstall: ${contradiction.name}`,
      });
    }

    if (install.length + uninstall.length > MAX_SKILL_BATCH_ENTRIES) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `too many skills in one batch (${install.length + uninstall.length}; limit ${MAX_SKILL_BATCH_ENTRIES})`,
      });
    }

    await ensureAgentReachable(deps.agentsRepo, agentId, deps.owner);
    const paths = sourcePaths ?? (await sourcePathsByGitUrl(deps, agentId));

    for (const entry of install) {
      const path = paths.get(entry.source);
      await deps.agentSkillsRepo.upsertSkill(agentId, {
        source: entry.source,
        name: entry.name,
        version: entry.version,
        ...(entry.contentHash !== undefined
          ? { contentHash: entry.contentHash }
          : {}),
        ...(path !== undefined ? { path } : {}),
      });
    }
    for (const entry of uninstall) {
      await deps.agentSkillsRepo.removeSkill(agentId, {
        source: entry.source,
        name: entry.name,
      });
    }

    await deps.runtimeMutator.bump(agentId, []);
    await deps.runtimeMutator.enqueueAfterCommit(agentId);

    for (const entry of install) {
      securityLog("info", "skill.install", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        agentId,
        target: entry.source,
        result: "success",
        detail: { name: entry.name, version: entry.version, batch: true },
      });
    }
    for (const entry of uninstall) {
      securityLog("info", "skill.uninstall", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        agentId,
        target: entry.source,
        result: "success",
        detail: { name: entry.name, batch: true },
      });
    }

    return deps.agentSkillsRepo.listSkills(agentId);
  };

  const service: SkillsService = {
    async listSources(agentId?: string) {
      const [owned, template] = await Promise.all([
        deps.repo.list(deps.owner),
        agentId
          ? loadTemplateSources(deps, agentId)
          : Promise.resolve<SkillSource[]>([]),
      ]);
      const seeds = deps.seedSources.map(seedToSkillSource);
      const merged = dedupeByGitUrl([...owned, ...seeds, ...template]);
      return sortSources(enrichSources(merged));
    },
    async getSource(id) {
      const s = await resolveSource(deps, id);
      if (!s) return null;
      const [enriched] = enrichSources([s]);
      return enriched;
    },
    async createSource(input: SkillCreateSourceInput) {
      try {
        const created = await deps.repo.create(input, deps.owner);
        const [enriched] = enrichSources([created]);
        return enriched;
      } catch (err) {
        if (isUniqueViolation(err, "skill_sources_owner_git_url_idx")) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "a skill source for this git URL is already registered",
          });
        }
        throw err;
      }
    },
    async deleteSource(id) {
      if (id.startsWith(TEMPLATE_SOURCE_ID_PREFIX)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "skill source is declared by an agent template and cannot be deleted",
        });
      }
      const src = await resolveSource(deps, id);
      try {
        await deps.repo.delete(id, deps.owner);
      } catch (err) {
        if (err instanceof SkillSourceProtectedError) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw err;
      }
      if (src) {
        const instances = await deps.agentsRepo.list(deps.owner);
        await deps.agentSkillsRepo.removeBySource(
          instances.map((i) => i.id),
          src.gitUrl,
        );
      }
    },

    async list(sourceId: string, agentId?: string) {
      const src = await resolveSource(deps, sourceId);
      if (!src) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `skill source ${JSON.stringify(sourceId)} not found`,
        });
      }

      const { skills, scannedAt, visibility } = await scanForSource(
        deps,
        src,
        agentId,
      );
      return {
        skills,
        scannedAt: new Date(scannedAt).toISOString(),
        visibility,
      };
    },

    async getSkillContent(sourceId: string, name: string, agentId?: string) {
      const src = await resolveSource(deps, sourceId);
      if (!src) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `skill source ${JSON.stringify(sourceId)} not found`,
        });
      }
      if (!detectHost(src.gitUrl)) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "in-product preview is only available for github.com sources",
        });
      }
      const { skills, viaPod } = await scanForSource(deps, src, agentId);
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `skill ${JSON.stringify(name)} not found in source`,
        });
      }

      if (!viaPod) {
        if (!skill.dir) {
          securityLog("warn", "skill.preview.unscoped_scan", {
            category: "privileged",
            actor: deps.owner,
            actorKind: "user",
            target: src.gitUrl,
            result: "failure",
            detail: { name },
          });
          throw new TRPCError({
            code: "NOT_IMPLEMENTED",
            message: "in-product preview isn't available for this skill",
          });
        }
        try {
          const content = await deps.readPublicSkillFile(
            src.gitUrl,
            skill.version,
            skill.dir,
          );
          return { content, dir: skill.dir };
        } catch (err) {
          if (err instanceof PublicArchiveNotFoundError) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `skill ${JSON.stringify(name)} no longer exists at the scanned revision`,
            });
          }
          throw err;
        }
      }

      if (!skill.dir) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "this sandbox's runtime is too old to locate the skill's directory",
        });
      }
      if (!agentId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "source is private; select an instance to read it",
        });
      }
      try {
        const { content } = await deps.runtimeClient.readSkillFile(agentId, {
          source: src.gitUrl,
          version: skill.version,
          dir: skill.dir,
        });
        return { content, dir: skill.dir };
      } catch (err) {
        throw (await podGithubVerdict(deps, err, agentId)) ?? err;
      }
    },

    async install(input: SkillInstallInput) {
      await ensureAgentReachable(deps.agentsRepo, input.agentId, deps.owner);

      const path = await resolveSourcePathByGitUrl(
        deps,
        input.agentId,
        input.source,
      );
      const ref: SkillRef = {
        source: input.source,
        name: input.name,
        version: input.version,
        ...(input.contentHash !== undefined
          ? { contentHash: input.contentHash }
          : {}),
        ...(path !== undefined ? { path } : {}),
      };
      await deps.agentSkillsRepo.upsertSkill(input.agentId, ref);
      await deps.runtimeMutator.bump(input.agentId, []);
      await deps.runtimeMutator.enqueueAfterCommit(input.agentId);
      securityLog("info", "skill.install", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        agentId: input.agentId,
        target: input.source,
        result: "success",
        detail: { name: input.name, version: input.version },
      });
      const current = await deps.agentSkillsRepo.listSkills(input.agentId);
      return upsertSkillRef(
        current.filter(
          (s) => !(s.source === ref.source && s.name === ref.name),
        ),
        ref,
      );
    },

    async uninstall(input: SkillUninstallInput) {
      await ensureAgentReachable(deps.agentsRepo, input.agentId, deps.owner);

      await deps.agentSkillsRepo.removeSkill(input.agentId, {
        source: input.source,
        name: input.name,
      });
      await deps.runtimeMutator.bump(input.agentId, []);
      await deps.runtimeMutator.enqueueAfterCommit(input.agentId);
      securityLog("info", "skill.uninstall", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        agentId: input.agentId,
        target: input.source,
        result: "success",
        detail: { name: input.name },
      });
      const current = await deps.agentSkillsRepo.listSkills(input.agentId);
      return removeSkillRef(current, {
        source: input.source,
        name: input.name,
      });
    },

    applyBatch(input) {
      return applyBatchWith(input);
    },

    async listSets() {
      return deps.skillSetsRepo.list(deps.owner);
    },

    async createSet(input) {
      const seen = new Set<string>();
      for (const entry of input.skills) {
        const key = skillKey(entry);
        if (seen.has(key)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `skill listed twice: ${entry.name}`,
          });
        }
        seen.add(key);
      }
      let set;
      try {
        set = await deps.skillSetsRepo.create(input, deps.owner);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A skill set named "${input.name}" already exists.`,
          });
        }
        throw err;
      }
      securityLog("info", "skill.set.create", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        target: set.id,
        result: "success",
        detail: {
          name: set.name,
          skills: set.skills.length,
          sources: [...new Set(set.skills.map((e) => e.source))],
        },
      });
      return set;
    },

    async deleteSet({ id }) {
      const existing = await deps.skillSetsRepo.get(id, deps.owner);
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "skill set not found",
        });
      }
      await deps.skillSetsRepo.delete(id, deps.owner);
      securityLog("info", "skill.set.delete", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        target: id,
        result: "success",
        detail: { name: existing.name },
      });
    },

    async applySets({ agentId, setIds }) {
      const sets = await Promise.all(
        setIds.map((id) => deps.skillSetsRepo.get(id, deps.owner)),
      );
      const missing = setIds.filter((_, i) => sets[i] === null);
      if (missing.length > 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `skill set not found: ${missing.join(", ")}`,
        });
      }

      const unreadable = sets.filter((s) => s?.entriesUnreadable);
      if (unreadable.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `skill set can't be read: ${unreadable
            .map((s) => s!.name)
            .join(", ")} — delete it and save it again`,
        });
      }

      const wanted = new Map<string, SkillSetEntry>();
      for (const set of sets) {
        for (const entry of set!.skills) {
          wanted.set(skillKey(entry), entry);
        }
      }

      if (wanted.size > MAX_SKILL_BATCH_ENTRIES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `these sets cover ${wanted.size} skills; one apply carries at most ${MAX_SKILL_BATCH_ENTRIES}`,
        });
      }

      const sources = await service.listSources(agentId);
      const connected = new Map(sources.map((s) => [s.gitUrl, s]));
      const sourcePaths = new Map(sources.map((s) => [s.gitUrl, s.path]));

      const skipped: (SkillSetEntry & { reason: SkillSetSkipReason })[] = [];
      const byGitUrl = new Map<string, SkillSetEntry[]>();
      for (const entry of wanted.values()) {
        const source = connected.get(entry.source);
        if (!source) {
          skipped.push({ ...entry, reason: "source-not-connected" });
          continue;
        }
        const list = byGitUrl.get(entry.source) ?? [];
        list.push(entry);
        byGitUrl.set(entry.source, list);
      }

      const installedKeys = new Set(
        (await deps.agentSkillsRepo.listSkills(agentId)).map(skillKey),
      );
      const toInstall: SkillApplyBatchInput["install"] = [];
      for (const [gitUrl, entries] of byGitUrl) {
        const source = connected.get(gitUrl)!;
        let scanned: Map<string, Skill>;
        try {
          const { skills } = await service.list(source.id, agentId);
          scanned = new Map(skills.map((s) => [s.name, s]));
        } catch (err) {
          getLogger().warn(
            { err, source: gitUrl, agentId },
            "skills set apply: source unreadable, skipping its entries",
          );
          for (const entry of entries) {
            skipped.push({ ...entry, reason: "source-unreadable" });
          }
          continue;
        }
        for (const entry of entries) {
          const match = scanned.get(entry.name);
          if (!match) {
            skipped.push({ ...entry, reason: "not-in-source" });
            continue;
          }
          if (installedKeys.has(skillKey(entry))) continue;
          toInstall.push({
            source: match.source,
            name: match.name,
            version: match.version,
            contentHash: match.contentHash,
          });
        }
      }

      const after = await applyBatchWith(
        { agentId, install: toInstall, uninstall: [] },
        sourcePaths,
      );
      return { installed: after, skipped, added: toInstall.length };
    },

    async createLocal(input: SkillCreateLocalInput): Promise<LocalSkill[]> {
      await ensureAgentReachable(deps.agentsRepo, input.agentId, deps.owner);
      let created: LocalSkill[];
      try {
        created = await deps.runtimeClient.writeLocal(
          input.agentId,
          input.skills,
        );
      } catch (err) {
        if (err instanceof AgentRuntimeConflictError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        throw err;
      }
      securityLog("info", "skill.create_local", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        agentId: input.agentId,
        target: "local",
        result: "success",
        detail: { names: input.skills.map((s) => s.name) },
      });
      return created;
    },

    async deleteLocal(input: SkillDeleteLocalInput): Promise<LocalSkill[]> {
      await ensureAgentReachable(deps.agentsRepo, input.agentId, deps.owner);
      const tracked = await deps.agentSkillsRepo.listSkills(input.agentId);
      if (tracked.some((s) => s.name === input.name)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `skill ${JSON.stringify(input.name)} is installed from a source; uninstall it instead`,
        });
      }
      try {
        await deps.runtimeClient.deleteLocal(input.agentId, input.name);
      } catch (err) {
        throw asPodVerdict(err);
      }
      securityLog("info", "skill.delete_local", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        agentId: input.agentId,
        target: "local",
        result: "success",
        detail: { name: input.name },
      });
      return standaloneFor(deps, input.agentId, tracked);
    },

    async readLocal(input: SkillReadLocalInput): Promise<SkillLocalFiles> {
      await ensureAgentReachable(deps.agentsRepo, input.agentId, deps.owner);
      try {
        return await deps.runtimeClient.readLocal(input.agentId, input.name);
      } catch (err) {
        throw asPodVerdict(err);
      }
    },

    async publish(input: SkillPublishInput): Promise<SkillPublishResult> {
      const result = await runPublishSkill(
        {
          owner: deps.owner,
          resolveSource: (id) => resolveSource(deps, id),
          agentSkills: deps.agentSkillsRepo,
          agents: deps.agentsRepo,
          runtimeClient: deps.runtimeClient,
          brandName: deps.brandName,
        },
        input,
      );
      const source = await resolveSource(deps, input.sourceId);
      if (source) deps.invalidateScan(source.gitUrl, source.path);
      return result;
    },

    async refreshSource(id: string): Promise<void> {
      const source = await resolveSource(deps, id);
      if (!source)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "skill source not found",
        });
      deps.invalidateScan(source.gitUrl, source.path);
    },

    async listLocal(agentId: string): Promise<LocalSkill[]> {
      const infra = await deps.agentsRepo.get(agentId, deps.owner);
      if (!infra) return [];
      if (computeAgentState(infra) !== "running") return [];
      const tracked = await deps.agentSkillsRepo.listSkills(agentId);
      return standaloneFor(deps, agentId, tracked);
    },

    async getState(agentId: string): Promise<SkillsState> {
      const infra = await deps.agentsRepo.get(agentId, deps.owner);
      if (!infra)
        return { installed: [], standalone: [], instancePublishes: [] };
      if (computeAgentState(infra) !== "running") {
        const [installed, instancePublishes, recorded] = await Promise.all([
          deps.agentSkillsRepo.listSkills(agentId),
          deps.agentSkillsRepo.listPublishes(agentId),
          deps.agentSkillsRepo.readStandaloneSnapshot(agentId),
        ]);
        if (!recorded) return { installed, standalone: [], instancePublishes };
        return {
          installed,
          standalone: recorded.skills,
          instancePublishes,
          standaloneSnapshot: { capturedAt: recorded.capturedAt },
        };
      }

      const instancePublishes =
        await deps.agentSkillsRepo.listPublishes(agentId);
      const publishedNames = [
        ...new Set(instancePublishes.map((p) => p.skillName)),
      ];

      const local = await deps.runtimeClient.listLocal(agentId, publishedNames);

      const onDisk = new Set(local.map((s) => s.name));

      let settled = false;
      try {
        settled = await deps.runtimeSettled.isSettled(agentId);
      } catch (err) {
        getLogger().warn(
          { err, agentId },
          "skills state: settled check failed; deferring reconcile",
        );
      }
      if (settled) {
        await deps.agentSkillsRepo.reconcile(agentId, onDisk);
      }

      const installed = await deps.agentSkillsRepo.listSkills(agentId);

      const trackedNames = new Set(installed.map((s) => s.name));
      const standalone = local.filter((s) => !trackedNames.has(s.name));

      try {
        await deps.agentSkillsRepo.recordStandaloneSnapshot(
          agentId,
          standalone,
        );
      } catch (err) {
        getLogger().warn(
          { err, agentId },
          "skills: recording the standalone snapshot failed",
        );
      }

      return { installed, standalone, instancePublishes };
    },
  };
  return service;
}
