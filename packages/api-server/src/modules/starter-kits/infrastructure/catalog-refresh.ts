import { loadYamlDocument } from "../../../core/yaml-document.js";
import * as path from "node:path";
import type {
  ResolvedSkill,
  ResolvedStarterKit,
  StarterKit,
  StarterKitCatalogEntry,
} from "api-server-api";
import { starterKitCatalogSchema, starterKitSchema } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import { type CatalogSource, relPathEscapes } from "./catalog-source.js";
import type { GitHosts } from "./git-hosts.js";
import type { RefResolver } from "./git-ref-resolver.js";
import type {
  ResolvedCatalogRepository,
  ResolvedKitRow,
} from "./resolved-catalog-repository.js";

const CATALOG_FILE = "catalog.yaml";
const KIT_FILE = "kit.yaml";

export interface NamedCatalog {
  name: string;
  source: CatalogSource;
  gitUrl?: string;
  ref?: string;
  entryHosts: GitHosts;
}

export interface CatalogRefreshDeps {
  catalogs: readonly NamedCatalog[];
  repo: ResolvedCatalogRepository;
  refs: RefResolver;
  appVersion: string;
  scanSkills: (
    gitUrl: string,
    ref: string,
    subPath: string,
  ) => Promise<ResolvedSkill[]>;
  sourceForEntry: (gitUrl: string, ref: string) => CatalogSource;
  avatar: {
    maxBytes: number;
    store: (
      bytes: Buffer,
      ownerSub: string,
    ) => Promise<{ avatar: `image:${string}` } | { error: string }>;
  };
}

export interface CatalogRefresh {
  run(): Promise<void>;
}

export interface KitFailure {
  kind: "rejected" | "unreadable";
  reason: string;
}

export type KitResolverDeps = Pick<
  CatalogRefreshDeps,
  "refs" | "appVersion" | "scanSkills" | "sourceForEntry"
> & { avatar?: CatalogRefreshDeps["avatar"] };

export interface KitResolver {
  resolve(
    named: NamedCatalog,
    entry: StarterKitCatalogEntry,
  ): Promise<ResolvedKitRow | KitFailure>;
}

function rejected(reason: string): KitFailure {
  return { kind: "rejected", reason };
}

function unreadable(reason: string): KitFailure {
  return { kind: "unreadable", reason };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads one kit the way a catalog entry names it:
 * resolves its ref to a commit, reads and validates `kit.yaml` there, pins its
 * seed and scans its bundled skills. The catalog refresh runs it for every
 * entry; a Linked Kit runs it for the one repository a user pasted. A failure
 * says why in words a user can act on, beside the log line an operator reads.
 * Without an avatar store a kit's avatar image is dropped and the kit keeps
 * the default one.
 */
export function createKitResolver(deps: KitResolverDeps): KitResolver {
  async function resolveAvatar(
    named: NamedCatalog,
    entry: StarterKitCatalogEntry,
    source: CatalogSource,
    kit: StarterKit,
  ): Promise<ResolvedStarterKit["avatar"]> {
    if (typeof kit.avatar !== "object") return kit.avatar;
    if (!deps.avatar) return undefined;
    const store = deps.avatar;
    const avatarPath = kit.avatar.path;
    const fail = (reason: string) => {
      getLogger().warn(
        { catalog: named.name, id: kit.id, path: avatarPath, reason },
        "starter kits: the kit's avatar image is not usable; the kit keeps the default avatar",
      );
      return undefined;
    };
    if (relPathEscapes(avatarPath)) return fail("path escapes the kit");
    try {
      const bytes = await source.readBytes(
        path.posix.join(entry.path, avatarPath),
        store.maxBytes,
      );
      if (bytes === null) return fail("file not found");
      const stored = await store.store(
        bytes,
        `kit:${named.name}/${kit.id}`,
      );
      return "error" in stored ? fail(stored.error) : stored.avatar;
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  async function resolveEntry(
    named: NamedCatalog,
    entry: StarterKitCatalogEntry,
  ): Promise<ResolvedKitRow | KitFailure> {
    if (relPathEscapes(entry.path)) {
      getLogger().warn(
        { catalog: named.name, path: entry.path },
        "starter kits: entry path rejected",
      );
      return rejected(`the kit path ${entry.path} leaves the repository`);
    }

    if (entry.url && !named.entryHosts.locate(entry.url)) {
      getLogger().warn(
        {
          catalog: named.name,
          url: entry.url,
          mayRead: named.entryHosts.readableHosts,
        },
        "starter kits: the entry names a host this catalog may not aim at; the entry is withdrawn",
      );
      return rejected(
        `${entry.url} is not on a host kits may be read from here (${named.entryHosts.readableHosts.join(", ")})`,
      );
    }

    const gitUrl = entry.url ?? named.gitUrl;
    let version = deps.appVersion;
    let source = named.source;

    if (gitUrl) {
      const ref = entry.ref ?? named.ref;
      const resolution = await deps.refs.resolve(gitUrl, ref);
      if (resolution.status !== "resolved") {
        getLogger().warn(
          { catalog: named.name, gitUrl, ref, status: resolution.status },
          resolution.status === "absent"
            ? "starter kits: the entry's ref is gone; the entry is withdrawn"
            : "starter kits: could not reach the entry's repository",
        );
        return resolution.status === "absent"
          ? rejected(
              ref
                ? `${gitUrl} has no branch, tag or commit named ${ref}`
                : `${gitUrl} could not be found, or it is not public`,
            )
          : unreadable(`${gitUrl} could not be reached; try again`);
      }
      version = resolution.sha;
      source = deps.sourceForEntry(gitUrl, resolution.sha);
    }

    const kitPath = path.posix.join(entry.path, KIT_FILE);
    const text = await source.readText(kitPath);
    if (text === null) {
      getLogger().warn(
        { catalog: named.name, source: source.locator, path: kitPath },
        "starter kits: kit.yaml not found at the resolved commit",
      );
      return rejected(`${gitUrl ?? "the catalog"} has no ${kitPath}`);
    }
    const parsed = starterKitSchema.safeParse(loadYamlDocument(text));
    if (!parsed.success) {
      getLogger().warn(
        {
          catalog: named.name,
          source: source.locator,
          issues: parsed.error.issues,
        },
        "starter kits: kit.yaml rejected",
      );
      return rejected(
        `${kitPath} is not a valid kit: ${parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ")}`,
      );
    }
    const kit = parsed.data;

    const seedUrl = kit.seed?.self ? gitUrl : kit.seed?.url;
    if (seedUrl && !named.entryHosts.locate(seedUrl)) {
      getLogger().warn(
        {
          catalog: named.name,
          id: kit.id,
          seedUrl,
          mayRead: named.entryHosts.readableHosts,
        },
        "starter kits: the kit's seed names a host this catalog may not aim at; the kit is withdrawn",
      );
      return rejected(
        `the kit's seed ${seedUrl} is not on a host kits may be read from here (${named.entryHosts.readableHosts.join(", ")})`,
      );
    }
    let seedRef: string | undefined;
    if (seedUrl) {
      if (seedUrl === gitUrl && kit.seed?.ref === undefined) {
        seedRef = version;
      } else {
        const resolution = await deps.refs.resolve(seedUrl, kit.seed?.ref);
        if (resolution.status !== "resolved") {
          getLogger().warn(
            {
              catalog: named.name,
              id: kit.id,
              seedUrl,
              ref: kit.seed?.ref,
              status: resolution.status,
            },
            resolution.status === "absent"
              ? "starter kits: the seed ref is gone; the kit is withdrawn"
              : "starter kits: could not reach the seed repository",
          );
          return resolution.status === "absent"
            ? rejected(
                `the kit's seed ${seedUrl} has no ${kit.seed?.ref ?? "default branch"}`,
              )
            : unreadable(`the kit's seed ${seedUrl} could not be reached`);
        }
        seedRef = resolution.sha;
      }
    }

    let skillsInKit: ResolvedSkill[] = [];
    if (kit.bundledSkills && seedUrl && seedRef) {
      try {
        skillsInKit = await deps.scanSkills(
          seedUrl,
          seedRef,
          kit.bundledSkills.path,
        );
      } catch (err) {
        getLogger().warn(
          { catalog: named.name, id: kit.id, seedUrl, err },
          "starter kits: bundled skill scan failed",
        );
      }
    }

    if (kit.seed && seedUrl === undefined) {
      getLogger().warn(
        { catalog: named.name, id: kit.id },
        "starter kits: the kit's seed says `self` but the kit was not read from a repository",
      );
      return rejected(
        "the kit's seed says `self`, but the kit was not read from a repository",
      );
    }
    const { seed, avatar: _declared, ...rest } = kit;
    const avatar = await resolveAvatar(named, entry, source, kit);
    const withoutSeed = { ...rest, ...(avatar ? { avatar } : {}) };
    const pinnedKit: ResolvedStarterKit =
      seed && seedUrl
        ? {
            ...withoutSeed,
            seed: {
              ...seed,
              url: seedUrl,
              ...(seedRef && /^[0-9a-f]{40}$/i.test(seedRef)
                ? { commit: seedRef }
                : {}),
            },
          }
        : withoutSeed;

    return {
      catalog: named.name,
      kitId: kit.id,
      version,
      source: source.locator,
      kit: pinnedKit,
      skillsInKit,
    };
  }

  return { resolve: resolveEntry };
}

export function createCatalogRefresh(deps: CatalogRefreshDeps): CatalogRefresh {
  const kits = createKitResolver(deps);

  async function refreshCatalog(named: NamedCatalog): Promise<void> {
    const text = await named.source.readText(CATALOG_FILE);
    if (text === null) {
      getLogger().warn(
        { catalog: named.name, source: named.source.locator },
        "starter kits: catalog.yaml could not be read; the stored kits are kept",
      );
      return;
    }
    const parsed = starterKitCatalogSchema.safeParse(loadYamlDocument(text));
    if (!parsed.success) {
      getLogger().warn(
        { catalog: named.name, issues: parsed.error.issues },
        "starter kits: catalog.yaml rejected",
      );
      return;
    }

    const resolved = await Promise.all(
      parsed.data.kits.map((entry) =>
        kits.resolve(named, entry).catch((err: unknown) => {
          getLogger().warn(
            { catalog: named.name, path: entry.path, err },
            "starter kits: entry failed to resolve",
          );
          return unreadable(err instanceof Error ? err.message : String(err));
        }),
      ),
    );

    const byId = new Map<string, ResolvedKitRow>();
    for (const row of resolved) {
      if ("kind" in row) continue;
      if (byId.has(row.kitId)) {
        getLogger().warn(
          { catalog: named.name, id: row.kitId },
          "starter kits: duplicate kit id within a catalog dropped",
        );
        continue;
      }
      byId.set(row.kitId, row);
    }
    const rows = [...byId.values()];
    const unread = resolved.filter(
      (row) => "kind" in row && row.kind === "unreadable",
    ).length;
    if (unread > 0) {
      getLogger().warn(
        { catalog: named.name, unreadable: unread, resolved: rows.length },
        "starter kits: incomplete read; the unreadable entries keep their stored rows",
      );
      await deps.repo.upsert(rows);
      return;
    }
    await deps.repo.replaceCatalog(named.name, rows);
  }

  return {
    async run() {
      for (const named of deps.catalogs) {
        await refreshCatalog(named).catch((err: unknown) => {
          getLogger().warn(
            { catalog: named.name, err },
            "starter kits: catalog refresh failed",
          );
        });
      }
    },
  };
}
