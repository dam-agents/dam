import { loadYamlDocument } from "../../../core/yaml-document.js";
import * as path from "node:path";
import type {
  ResolvedSkill,
  ResolvedStarterKit,
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
}

export interface CatalogRefresh {
  run(): Promise<void>;
}

type EntryFailure = "rejected" | "unreadable";

export function createCatalogRefresh(deps: CatalogRefreshDeps): CatalogRefresh {
  async function resolveEntry(
    named: NamedCatalog,
    entry: StarterKitCatalogEntry,
  ): Promise<ResolvedKitRow | EntryFailure> {
    if (relPathEscapes(entry.path)) {
      getLogger().warn(
        { catalog: named.name, path: entry.path },
        "starter kits: entry path rejected",
      );
      return "rejected";
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
      return "rejected";
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
        return resolution.status === "absent" ? "rejected" : "unreadable";
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
      return "rejected";
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
      return "rejected";
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
      return "rejected";
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
          return resolution.status === "absent" ? "rejected" : "unreadable";
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
      return "rejected";
    }
    const { seed, ...withoutSeed } = kit;
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
        resolveEntry(named, entry).catch((err: unknown) => {
          getLogger().warn(
            { catalog: named.name, path: entry.path, err },
            "starter kits: entry failed to resolve",
          );
          return "unreadable" as const;
        }),
      ),
    );

    const byId = new Map<string, ResolvedKitRow>();
    for (const row of resolved) {
      if (typeof row === "string") continue;
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
    const unreadable = resolved.filter((row) => row === "unreadable").length;
    if (unreadable > 0) {
      getLogger().warn(
        { catalog: named.name, unreadable, resolved: rows.length },
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
