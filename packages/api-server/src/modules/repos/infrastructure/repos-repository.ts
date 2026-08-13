import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import type { Repo, ReposService } from "api-server-api";
import { repoSchema } from "api-server-api";

const REPOS_FILE = "git-repos.yaml";

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
