import yaml from "js-yaml";
import * as path from "node:path";
import type { ResolvedSkill, StarterKitCatalogEntry } from "api-server-api";
import { starterKitCatalogSchema, starterKitSchema } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import {
  type CatalogSource,
  createGithubCatalogSource,
  relPathEscapes,
} from "./catalog-source.js";
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
  sourceForEntry?: (gitUrl: string, ref: string) => CatalogSource;
}

export interface CatalogRefresh {
  run(): Promise<void>;
}

export function createCatalogRefresh(deps: CatalogRefreshDeps): CatalogRefresh {
  async function resolveEntry(
    named: NamedCatalog,
    entry: StarterKitCatalogEntry,
  ): Promise<ResolvedKitRow | null> {
    if (relPathEscapes(entry.path)) {
      getLogger().warn(
        { catalog: named.name, path: entry.path },
        "starter kits: entry path rejected",
      );
      return null;
    }

    const gitUrl = entry.gitUrl ?? named.gitUrl;
    let version = deps.appVersion;
    let source = named.source;

    if (gitUrl) {
      const sha = await deps.refs.resolve(gitUrl, entry.ref ?? named.ref);
      if (!sha) {
        getLogger().warn(
          { catalog: named.name, gitUrl, ref: entry.ref ?? named.ref },
          "starter kits: could not resolve ref to a commit",
        );
        return null;
      }
      version = sha;
      if (entry.gitUrl)
        source = (deps.sourceForEntry ?? createGithubCatalogSource)(
          entry.gitUrl,
          sha,
        );
    }

    const kitPath = path.posix.join(entry.path, KIT_FILE);
    const text = await source.readText(kitPath);
    if (text === null) {
      getLogger().warn(
        { catalog: named.name, source: source.locator, path: kitPath },
        "starter kits: kit.yaml not found",
      );
      return null;
    }
    const parsed = starterKitSchema.safeParse(yaml.load(text));
    if (!parsed.success) {
      getLogger().warn(
        {
          catalog: named.name,
          source: source.locator,
          issues: parsed.error.issues,
        },
        "starter kits: kit.yaml rejected",
      );
      return null;
    }
    const kit = parsed.data;

    let skillsInKit: ResolvedSkill[] = [];
    const seedUrl = kit.seed?.url ?? gitUrl;
    if (kit.bundledSkills && seedUrl) {
      const seedRef = kit.seed?.ref
        ? ((await deps.refs.resolve(seedUrl, kit.seed.ref)) ?? kit.seed.ref)
        : seedUrl === gitUrl
          ? version
          : ((await deps.refs.resolve(seedUrl)) ?? "HEAD");
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

    return {
      catalog: named.name,
      kitId: kit.id,
      version,
      source: source.locator,
      kit,
      skillsInKit,
    };
  }

  async function refreshCatalog(named: NamedCatalog): Promise<void> {
    const text = await named.source.readText(CATALOG_FILE);
    if (text === null) {
      getLogger().warn(
        { catalog: named.name, source: named.source.locator },
        "starter kits: catalog.yaml not found",
      );
      return;
    }
    const parsed = starterKitCatalogSchema.safeParse(yaml.load(text));
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
          return null;
        }),
      ),
    );

    const byId = new Map<string, ResolvedKitRow>();
    for (const row of resolved) {
      if (!row) continue;
      if (byId.has(row.kitId)) {
        getLogger().warn(
          { catalog: named.name, id: row.kitId },
          "starter kits: duplicate kit id within a catalog dropped",
        );
        continue;
      }
      byId.set(row.kitId, row);
    }
    await deps.repo.replaceCatalog(named.name, [...byId.values()]);
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
