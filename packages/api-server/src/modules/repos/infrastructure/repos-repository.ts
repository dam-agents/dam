import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { Repo, ReposService } from "api-server-api";
import { repoSchema } from "api-server-api";

const REPOS_FILE = "git-repos.yaml";

/**
 * The `gitRepos` catalog is chart-shipped config: a single `git-repos.yaml` (a
 * list) mounted from a ConfigMap. It changes only on helm upgrade (which
 * restarts the pod), so load it once at construction. The repository is itself
 * the ReposService — there's no per-id lookup to justify a separate service.
 * An empty/missing `dir` yields an empty catalog.
 */
export function createReposRepository(dir: string): ReposService {
  const repos = loadRepos(dir);
  return {
    async list() {
      return repos;
    },
  };
}

function loadRepos(dir: string): Repo[] {
  if (!dir) return [];
  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(join(dir, REPOS_FILE), "utf8"));
  } catch (err) {
    process.stderr.write(
      `git-repos: ${join(dir, REPOS_FILE)}: ${err instanceof Error ? err.message : err}\n`,
    );
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const repos: Repo[] = [];
  for (const entry of raw) {
    const parsed = repoSchema.safeParse(entry);
    if (parsed.success) {
      repos.push(parsed.data);
    } else {
      process.stderr.write(
        `git-repos: skipping invalid entry: ${parsed.error.message}\n`,
      );
    }
  }
  return repos;
}
