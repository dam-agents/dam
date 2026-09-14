import * as path from "node:path";
import yaml from "js-yaml";
import type { StarterKit, StarterKitCatalogEntry } from "api-server-api";
import { starterKitCatalogSchema, starterKitSchema } from "api-server-api";
import { getLogger } from "../../../core/logger.js";
import {
  type CatalogSource,
  createGithubCatalogSource,
  relPathEscapes,
} from "./catalog-source.js";

export interface LoadedKit {
  kit: StarterKit;
  version: string;
  source: string;
}

export interface StarterKitsRepository {
  list(): Promise<LoadedKit[]>;
  get(id: string): Promise<LoadedKit | null>;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const CATALOG_FILE = "catalog.yaml";
const KIT_FILE = "kit.yaml";

export function createStarterKitsRepository(opts: {
  catalog: CatalogSource | null;
  sourceForEntry?: (gitUrl: string, ref: string) => CatalogSource;
  ttlMs?: number;
  now?: () => number;
}): StarterKitsRepository {
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? (() => Date.now());
  const sourceForEntry =
    opts.sourceForEntry ??
    ((gitUrl: string, ref: string) => createGithubCatalogSource(gitUrl, ref));

  let cached: { at: number; kits: LoadedKit[] } | null = null;
  let inflight: Promise<LoadedKit[]> | null = null;

  async function loadEntry(
    catalog: CatalogSource,
    entry: StarterKitCatalogEntry,
  ): Promise<LoadedKit | null> {
    const source = entry.gitUrl
      ? sourceForEntry(entry.gitUrl, entry.ref ?? "HEAD")
      : catalog;
    if (relPathEscapes(entry.path)) {
      getLogger().warn(
        { path: entry.path },
        "starter kits: entry path rejected",
      );
      return null;
    }
    const kitPath = path.posix.join(entry.path, KIT_FILE);
    const text = await source.readText(kitPath);
    if (text === null) {
      getLogger().warn(
        { source: source.locator, path: kitPath },
        "starter kits: kit.yaml not found",
      );
      return null;
    }
    const parsed = starterKitSchema.safeParse(yaml.load(text));
    if (!parsed.success) {
      getLogger().warn(
        { source: source.locator, path: kitPath, issues: parsed.error.issues },
        "starter kits: kit.yaml rejected",
      );
      return null;
    }
    return {
      kit: parsed.data,
      version: entry.gitUrl ? (entry.ref ?? "HEAD") : catalogVersion(catalog),
      source: source.locator,
    };
  }

  async function loadAll(): Promise<LoadedKit[]> {
    const catalog = opts.catalog;
    if (!catalog) return [];
    const text = await catalog.readText(CATALOG_FILE);
    if (text === null) {
      getLogger().warn(
        { source: catalog.locator },
        "starter kits: catalog.yaml not found",
      );
      return [];
    }
    const parsed = starterKitCatalogSchema.safeParse(yaml.load(text));
    if (!parsed.success) {
      getLogger().warn(
        { source: catalog.locator, issues: parsed.error.issues },
        "starter kits: catalog.yaml rejected",
      );
      return [];
    }
    const loaded = await Promise.all(
      parsed.data.kits.map((entry) => loadEntry(catalog, entry)),
    );
    const byId = new Map<string, LoadedKit>();
    for (const item of loaded) {
      if (!item) continue;
      if (byId.has(item.kit.id)) {
        getLogger().warn(
          { id: item.kit.id, source: item.source },
          "starter kits: duplicate kit id dropped",
        );
        continue;
      }
      byId.set(item.kit.id, item);
    }
    return [...byId.values()];
  }

  async function list(): Promise<LoadedKit[]> {
    if (cached && now() - cached.at < ttl) return cached.kits;
    if (!inflight) {
      inflight = loadAll()
        .then((kits) => {
          cached = { at: now(), kits };
          return kits;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  }

  return {
    list,
    async get(id) {
      return (await list()).find((k) => k.kit.id === id) ?? null;
    },
  };
}

function catalogVersion(catalog: CatalogSource): string {
  const hash = catalog.locator.indexOf("#");
  if (hash === -1) return "local";
  const tail = catalog.locator.slice(hash + 1);
  const colon = tail.indexOf(":");
  return colon === -1 ? tail : tail.slice(0, colon);
}
