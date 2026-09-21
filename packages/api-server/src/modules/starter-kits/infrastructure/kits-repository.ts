import type { ResolvedSkill, ResolvedStarterKit } from "api-server-api";
import type { ResolvedCatalogRepository } from "./resolved-catalog-repository.js";

export interface LoadedKit {
  kit: ResolvedStarterKit;
  catalog: string;
  version: string;
  source: string;
  skillsInKit: ResolvedSkill[];
}

export interface StarterKitsRepository {
  list(): Promise<LoadedKit[]>;
  get(catalog: string, id: string): Promise<LoadedKit | null>;
}

export function createStarterKitsRepository(opts: {
  resolved: ResolvedCatalogRepository;
}): StarterKitsRepository {
  return {
    async list() {
      return (await opts.resolved.list()).map((row) => ({
        kit: row.kit,
        catalog: row.catalog,
        version: row.version,
        source: row.source,
        skillsInKit: row.skillsInKit,
      }));
    },

    async get(catalog, id) {
      const row = await opts.resolved.get(catalog, id);
      return row
        ? {
            kit: row.kit,
            catalog: row.catalog,
            version: row.version,
            source: row.source,
            skillsInKit: row.skillsInKit,
          }
        : null;
    },
  };
}
