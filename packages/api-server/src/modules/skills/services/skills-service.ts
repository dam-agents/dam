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

export interface SkillsServiceDeps {
  repo: SkillsRepository;
  skillSetsRepo: SkillSetsRepository;
  agentSkillsRepo: AgentSkillsRepository;
  agentsRepo: AgentsRepository;
  templatesRepo: TemplatesRepository;
  /** System (cluster-admin-declared) Skill Sources, parsed once at api-server
   *  startup from SKILL_SOURCES_SEED. Merged into listSources() with
   *  `system: true` and protected from deletion. */
  seedSources: SkillSourceSeed[];
  runtimeClient: AgentRuntimeSkillsClient;
  /** Answers whether a sandbox can authenticate to GitHub at all — the one
   *  thing a failed scan's upstream status cannot tell us apart from a repo
   *  the connection simply wasn't granted. Read only on the failure path. */
  githubCredential: GithubCredentialPort;
  runtimeMutator: RuntimeMutator;
  /** Whether the pod has applied everything the outbox has asked of it. The
   *  `state` reconcile is only sound once it has: until then a tracked skill's
   *  directory is legitimately absent, because the apply that writes it hasn't
   *  run yet. */
  isRuntimeSettled: (agentId: string) => Promise<boolean>;
  owner: string;
  /** Scan via the provided scanner with a TTL cache, keyed by `(gitUrl, path)`
   *  — the catalogue depends on both, and the same repo may be pointed at
   *  different subdirs. `scope` says what the result depended on: an
   *  uncredentialed scan is shared across users, a scan that ran under one
   *  user's credentials is served only back to them. Also reports when the
   *  returned list was read from upstream (epoch ms), which a cache hit answers
   *  with the original read rather than the hit. */
  scanSource: (
    scope: ScanScope,
    gitUrl: string,
    path: string | undefined,
    scanner: (gitUrl: string) => Promise<Skill[]>,
  ) => Promise<{ skills: Skill[]; scannedAt: number }>;
  invalidateScan: (gitUrl: string, path: string | undefined) => void;
  /** Scan a public GitHub repo directly from the api-server pod. Throws
   *  `PublicArchiveNotFoundError` when the archive endpoint returns 404 —
   *  signal to the caller to fall back to the agent-runtime path for
   *  private-repo auth (if the instance is running). */
  scanPublic: (gitUrl: string, path?: string) => Promise<Skill[]>;
  /** Read one skill's raw `SKILL.md` at a pinned commit, given the repo-relative
   *  directory the scan already reported — one small GET, no tarball. Throws
   *  `PublicArchiveNotFoundError` on 404 (private repo). */
  readPublicSkillFile: (
    gitUrl: string,
    version: string,
    dir: string,
  ) => Promise<string>;
  /** Brand display name surfaced in publish-PR bodies. Sourced from runtime
   *  brand config so a deployment rebrand doesn't need a code change. */
  brandName: string;
}

/**
 * canPublish is a soft signal: "the publish infrastructure knows how to
 * target this host." True when the gitUrl parses as a GitHub URL — that's
 * the only host our publish flow supports today. Authentication/authorization
 * (is the user's GitHub connection live? is this agent granted access?)
 * is not preflighted here; any failure surfaces at publish time with a
 * precise CTA from upstream. Cheaper + harder to get stale than a cluster
 * call.
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
    ...(seed.path !== undefined ? { path: seed.path } : {}),
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

/** gitUrl → the source's subdir, for every source visible to this agent, using
 *  the same merge + dedupe precedence as listSources (user → system → template).
 *  Built once per call: a batch resolves many entries against one listing rather
 *  than re-listing sources per entry. */
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

/** Recover one source's subdir from its gitUrl. Install carries the gitUrl, not
 *  the source id, so this is how the path is found to denormalize onto the
 *  installed ref. */
async function resolveSourcePathByGitUrl(
  deps: SkillsServiceDeps,
  agentId: string,
  gitUrl: string,
): Promise<string | undefined> {
  return (await sourcePathsByGitUrl(deps, agentId)).get(gitUrl);
}

/** Re-throw a pod client-error verdict with its own code and message, so a
 *  missing skill answers 404 and a cap breach 413 rather than a 500. Anything
 *  else passes through untouched (and stays a server fault). */
function asPodVerdict(err: unknown): unknown {
  if (err instanceof AgentRuntimeClientError) {
    return new TRPCError({ code: err.code, message: err.podMessage });
  }
  return err;
}

/** On-disk Local Skills minus anything tracked as installed-from-remote (by
 *  name) — the same subtraction getState performs for its `standalone` view. */
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
  /** Which branch answered. `false` means the public archive under the
   *  `shared` scope; `true` means the agent's pod under that sandbox's scope.
   *  It is trustworthy because the cache is scoped: a `shared` lookup can never
   *  be served an `agent`-scoped entry, so the branch that produced the list is
   *  also the access level it was read with. */
  viaPod: boolean;
}

/**
 * One source's scanned skill list, and how it was obtained. Shared by `list`
 * and the content read so neither can drift into a different dispatch — the
 * content read used to call `scanPublic` directly, which is why a private
 * source could never resolve a directory.
 *
 * Every failure leaves here as a named verdict. The catch-all is the point:
 * whatever went wrong, the user gets a sentence they can act on and the real
 * error stays in the api-server's log, where a parser's complaint or a
 * Kubernetes message belongs.
 */
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

/**
 * Advice for a sandbox that couldn't be made ready, chosen from its state —
 * the generic "try again in a moment" is only true for a sandbox that is
 * coming up. Read on the failure path only.
 */
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

/**
 * The verdict for a GitHub failure that came back through a sandbox pod, or
 * null when this flow doesn't own the error.
 *
 * "Can't access the repo" and "there is no GitHub credential here" arrive as
 * the same 401/404 — only the sandbox's own connections tell them apart. That
 * read happens here and nowhere else, so it costs nothing until a scan has
 * already failed.
 */
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
  // Fast path: public GitHub repo scanned directly from api-server. This
  // works in every connection state (no app configured, not Connected,
  // not granted, fully granted) because api-server has direct internet
  // egress — it never touches the agent pod's per-grant gating.
  if (detectHost(src.gitUrl)) {
    try {
      const { skills, scannedAt } = await deps.scanSource(
        { kind: "shared" },
        src.gitUrl,
        src.path,
        (gitUrl) => deps.scanPublic(gitUrl, src.path),
      );
      return { skills, scannedAt, viaPod: false };
    } catch (err) {
      if (!(err instanceof PublicArchiveNotFoundError)) throw err;
      // 404 → repo is private (or nonexistent). Only the authenticated
      // agent-runtime path can distinguish those and surface a useful
      // CTA, so we fall through.
    }
  }

  // Private/authenticated path: delegate to agent-runtime inside a
  // running instance pod, whose Envoy sidecar performs the token swap.
  // Without an agentId we can't target a pod — refuse with a clear
  // message.
  if (!agentId) {
    throw scanFailureError("needs_sandbox");
  }
  // A sandbox that can't be woken is a verdict of its own — the raw wake
  // failure names a pod and a Kubernetes condition, neither of which the user
  // can act on. Its own state decides the advice, because "try again in a
  // moment" is false for a sandbox the owner stopped or the budget parked.
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
    return { skills, scannedAt, viaPod: true };
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
  return {
    async listSources(agentId?: string) {
      const [owned, template] = await Promise.all([
        deps.repo.list(deps.owner),
        agentId
          ? loadTemplateSources(deps, agentId)
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

      const { skills, scannedAt } = await scanForSource(deps, src, agentId);
      return { skills, scannedAt: new Date(scannedAt).toISOString() };
    },

    async getSkillContent(sourceId: string, name: string, agentId?: string) {
      const src = await resolveSource(deps, sourceId);
      if (!src) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `skill source ${JSON.stringify(sourceId)} not found`,
        });
      }
      // The one surviving limit, and it is about the host rather than privacy:
      // the pinned single-file read is GitHub-only, and reading one file out of
      // another host would mean a repo download per preview.
      if (!detectHost(src.gitUrl)) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "in-product preview is only available for github.com sources",
        });
      }
      // Resolve the skill's pinned {version, dir} from the same cached scan
      // `list` uses, then GET that one file — no repo download. A private repo
      // 404s the public archive inside the helper and escalates to the pod,
      // which is what makes a private preview possible at all. The wake, when
      // one is needed, happens in there too.
      const { skills, viaPod } = await scanForSource(deps, src, agentId);
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `skill ${JSON.stringify(name)} not found in source`,
        });
      }

      if (!viaPod) {
        // The public-archive scan always sets `dir`, and under scan scoping only
        // a public-archive scan answers a shared lookup — so a missing one means
        // a credentialed entry did, which is a scoping violation worth a line
        // rather than a quiet deferral.
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
          // The scan located this file, so a 404 on the pinned path means the
          // cached entry outlived the revision it described.
          if (err instanceof PublicArchiveNotFoundError) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `skill ${JSON.stringify(name)} no longer exists at the scanned revision`,
            });
          }
          throw err;
        }
      }

      // Pod scan, sandbox scope: the source is private. Here a missing `dir`
      // means the sandbox's runtime predates reporting it — a stale deployment,
      // not a scoping violation, so no security log.
      if (!skill.dir) {
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message:
            "this sandbox's runtime is too old to locate the skill's directory",
        });
      }
      // Reaching this branch required an agentId — the helper throws
      // PRECONDITION_FAILED otherwise — but narrow it rather than assert.
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
        // Same verdicts the pod scan reaches, so a missing GitHub connection
        // reads the same here as it does on the source card.
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
      // Supply-chain: code fetched from an arbitrary git URL onto the agent's
      // PV (often agent-driven via MCP). "what did this agent install, from
      // where" must be answerable post-incident.
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

    async applyBatch(input) {
      const { agentId, install, uninstall } = input;

      // Nothing to do: no wake, no bump, no log. The set-apply path leans on
      // this — adding a set whose skills are all already on must cost nothing.
      // Ownership is still enforced, so an unowned agent can't be probed.
      if (install.length === 0 && uninstall.length === 0) {
        if (!(await deps.agentsRepo.get(agentId, deps.owner))) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "agent not found",
          });
        }
        return deps.agentSkillsRepo.listSkills(agentId);
      }

      // Reject a self-contradicting batch before writing anything: picking a
      // winner would silently do something the caller didn't ask for.
      const key = (e: { source: string; name: string }) =>
        `${e.source} ${e.name}`;
      const removing = new Set(uninstall.map(key));
      const contradiction = install.find((e) => removing.has(key(e)));
      if (contradiction) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `skill is in both install and uninstall: ${contradiction.name}`,
        });
      }

      await ensureAgentReachable(deps.agentsRepo, agentId, deps.owner);
      const paths = await sourcePathsByGitUrl(deps, agentId);

      // Rows first, then one bump for the whole batch — the point of this path.
      // A failure part-way leaves rows the pod hasn't been told about; the next
      // `state` read reaps them as ghosts, so a partial batch self-heals.
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

      // Per skill, not per batch: "what did this agent install, from where" has
      // to stay answerable after an incident, and one aggregate line loses that.
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
    },

    async listSets() {
      return deps.skillSetsRepo.list(deps.owner);
    },

    async createSet(input) {
      const seen = new Set<string>();
      for (const entry of input.skills) {
        const key = `${entry.source} ${entry.name}`;
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
      // A set is a reusable instruction to fetch code from named repositories,
      // so its creation deserves the same answerability as an install.
      securityLog("info", "skill.set.create", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        target: set.id,
        result: "success",
        detail: { name: set.name, skills: set.skills.length },
      });
      return set;
    },

    async deleteSet(id) {
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

    async applySets(agentId, setIds) {
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

      // Union across the chosen sets: two sets sharing a skill install it once.
      const wanted = new Map<string, SkillSetEntry>();
      for (const set of sets) {
        for (const entry of set!.skills) {
          wanted.set(`${entry.source} ${entry.name}`, entry);
        }
      }

      // The merged source list, so system and template sources count too — not
      // just the user's own rows.
      const sources = await this.listSources(agentId);
      const connected = new Map(sources.map((s) => [s.gitUrl, s]));

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

      // One scan per distinct source, through the same cached dispatch `list`
      // uses. A source that can't be read blocks its own entries only: everything
      // reachable still lands and the user is told which skills didn't and why.
      // Refusing the whole apply would be worse for exactly the case sets exist
      // for — a set built where credentials are granted, applied where they
      // aren't — so the verdict is narrowed to a skip rather than propagated.
      // It is still a distinct reason from "not connected", because the fix
      // differs, and the underlying failure is logged rather than dropped.
      const installed = await deps.agentSkillsRepo.listSkills(agentId);
      const alreadyOn = new Set(installed.map((r) => `${r.source} ${r.name}`));
      const toInstall: SkillApplyBatchInput["install"] = [];
      for (const [gitUrl, entries] of byGitUrl) {
        const source = connected.get(gitUrl)!;
        let scanned: Map<string, Skill>;
        try {
          const { skills } = await this.list(source.id, agentId);
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
          // Already on at the same content: nothing to do. Re-installing would
          // be a wasted write and a misleading security-log line.
          const ref = installed.find(
            (r) => r.source === entry.source && r.name === entry.name,
          );
          if (
            alreadyOn.has(`${entry.source} ${entry.name}`) &&
            ref?.contentHash === match.contentHash
          ) {
            continue;
          }
          toInstall.push({
            source: match.source,
            name: match.name,
            version: match.version,
            contentHash: match.contentHash,
          });
        }
      }

      // Empty uninstall list is the additive guarantee, enforced here rather
      // than trusted to callers: a set adds skills, it never turns one off.
      const after = await this.applyBatch({
        agentId,
        install: toInstall,
        uninstall: [],
      });
      return { installed: after, skipped };
    },

    async createLocal(input: SkillCreateLocalInput): Promise<LocalSkill[]> {
      // Wakes a hibernated agent and rejects foreign/missing ones (owner-scoped).
      await ensureAgentReachable(deps.agentsRepo, input.agentId, deps.owner);
      let created: LocalSkill[];
      try {
        created = await deps.runtimeClient.writeLocal(
          input.agentId,
          input.skills,
        );
      } catch (err) {
        // Pass the pod's collision verdict through verbatim — the message names
        // the offending skills and the UI matches rows against it.
        if (err instanceof AgentRuntimeConflictError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        throw err;
      }
      // No agent_skills row, no outbox bump: a standalone Local Skill is
      // deliberately untracked — the reconciled `state` read surfaces it on the
      // next poll. User-authored content written onto the agent's PV must be
      // answerable post-incident, so log the write (parity with skill.install).
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
      // Wakes a hibernated agent and rejects foreign/missing ones (owner-scoped).
      await ensureAgentReachable(deps.agentsRepo, input.agentId, deps.owner);
      const tracked = await deps.agentSkillsRepo.listSkills(input.agentId);
      // deleteLocal is the standalone-only path: the UI never offers it for a
      // tracked skill, and letting it through would wipe an install while
      // leaving a row for the next `state` read to reap as a ghost.
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
      // Removing user-authored content from the agent's PV must be answerable
      // post-incident (parity with skill.create_local).
      securityLog("info", "skill.delete_local", {
        category: "privileged",
        actor: deps.owner,
        actorKind: "user",
        agentId: input.agentId,
        target: "local",
        result: "success",
        detail: { name: input.name },
      });
      // No agent_skills write, no outbox bump, and agent_skill_publishes rows
      // are left intact: a publish record logs something that really happened
      // and is reaped only by the AgentDeleted cleanup saga.
      return standaloneFor(deps, input.agentId, tracked);
    },

    async readLocal(input: SkillReadLocalInput): Promise<SkillLocalFiles> {
      await ensureAgentReachable(deps.agentsRepo, input.agentId, deps.owner);
      // A thin passthrough by design: the size caps and the not-found verdict
      // are pod-side. No security log — the Files panel already serves
      // arbitrary pod file content unlogged, so a skill read is strictly less.
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
      // Drop the scan cache for this source so the next listSkills reflects
      // the merged PR (whenever that happens — we don't wait, we just stop
      // serving a stale snapshot).
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
      // No filesystem to read when the pod isn't running.
      if (computeAgentState(infra) !== "running") return [];
      const tracked = await deps.agentSkillsRepo.listSkills(agentId);
      return standaloneFor(deps, agentId, tracked);
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
        // No snapshot means nothing was ever recorded, so the list stays empty
        // and unmarked — a never-run sandbox must not read as "has no skills".
        // Deliberately no reconciliation here: a snapshot is not evidence about
        // the current disk, and dropping tracked rows from it would be wrong.
        if (!recorded) return { installed, standalone: [], instancePublishes };
        return {
          installed,
          standalone: recorded.skills,
          instancePublishes,
          standaloneSnapshot: { capturedAt: recorded.capturedAt },
        };
      }

      // Publishes are read before the listing, not alongside it, because they
      // decide which skills need a contentHash and the listing is where the
      // hashing happens. Every published name needs one, not just the `merged`
      // ones: the UI de-duplicates on the hash matching the source's copy, and
      // gating that on our own knowledge of the pull request's state would leave
      // the duplicate on screen for as long as the resolver takes to notice a
      // merge — up to the re-check interval. A sandbox that never published
      // still asks for none.
      const instancePublishes =
        await deps.agentSkillsRepo.listPublishes(agentId);
      const publishedNames = [
        ...new Set(instancePublishes.map((p) => p.skillName)),
      ];

      const local = await deps.runtimeClient.listLocal(agentId, publishedNames);

      const onDisk = new Set(local.map((s) => s.name));

      // Drop ghost rows whose directories no longer exist — but only once the
      // pod has caught up with the outbox. Install is declarative: the row is
      // written first and the apply worker fetches the files after, so between
      // those two moments every freshly-installed skill looks like a ghost.
      // Reaping then doesn't just lose the install — the files still land, and
      // the skill resurfaces as a Standalone one the user supposedly authored.
      // One install's window is a single fetch wide; a batch's is N, which is
      // what makes the guard necessary rather than merely tidy.
      if (await deps.isRuntimeSettled(agentId)) {
        await deps.agentSkillsRepo.reconcile(agentId, onDisk);
      }

      const installed = await deps.agentSkillsRepo.listSkills(agentId);

      const trackedNames = new Set(installed.map((s) => s.name));
      const standalone = local.filter((s) => !trackedNames.has(s.name));

      // Record the computed list, not the raw local one: this is what the
      // stopped branch has to return, already reconciled against tracked names.
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
}
