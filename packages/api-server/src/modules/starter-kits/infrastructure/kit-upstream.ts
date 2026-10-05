import type { KitUpdateChanges, KitUpdateCommit } from "api-server-api";

import { getLogger } from "../../../core/logger.js";
import { changelogBetween } from "../domain/changelog-range.js";
import { readTextWithin } from "./bounded-read.js";
import { createGitCatalogSource } from "./catalog-source.js";
import type { GitHosts } from "./git-hosts.js";
import type { RefResolution, RefResolver } from "./git-ref-resolver.js";

const FRESH_TTL_MS = 5 * 60 * 1000;
const STALE_TTL_MS = 30 * 60 * 1000;
const MAX_COMMITS = 20;
const MAX_COMPARE_BYTES = 4 * 1024 * 1024;
const MAX_CHANGES_ENTRIES = 500;

export interface KitUpstream {
  head(url: string, branch?: string): Promise<RefResolution>;
  changes(url: string, from: string, to: string): Promise<KitUpdateChanges>;
}

interface HeadEntry {
  value: RefResolution;
  readAt: number;
}

interface CompareBody {
  total_commits?: number;
  commits?: { sha: string; commit?: { message?: string } }[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads what a Kit Update needs from the seed's
 * repository, on read rather than from a job. The head of a stamped branch is
 * cached per replica like the skill scan cache: fresh for minutes, then served
 * stale while one re-read runs behind it, and waited on only once too old. What
 * changed between two commits never changes, so it is cached without expiry.
 */
export function createKitUpstream(deps: {
  hosts: GitHosts;
  refs: RefResolver;
  fetchImpl?: typeof fetch;
  now?: () => number;
}): KitUpstream {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const heads = new Map<string, HeadEntry>();
  const inflight = new Map<string, Promise<RefResolution>>();
  const changesCache = new Map<string, Promise<KitUpdateChanges>>();

  function readHead(key: string, url: string, branch?: string) {
    const running = inflight.get(key);
    if (running) return running;
    const read = deps.refs
      .resolve(url, branch)
      .catch((): RefResolution => ({ status: "unreachable" }))
      .then((value) => {
        heads.set(key, { value, readAt: now() });
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, read);
    return read;
  }

  async function readVersion(url: string, commit: string) {
    const text = await createGitCatalogSource(
      deps.hosts,
      url,
      commit,
      fetchImpl,
    )
      .readText("VERSION")
      .catch(() => null);
    return text?.split("\n")[0]?.trim() || null;
  }

  async function readCommits(url: string, from: string, to: string) {
    const repo = deps.hosts.locate(url);
    if (!repo) return null;
    const request = repo.compare(from, to);
    try {
      const res = await fetchImpl(request.url, { headers: request.headers });
      if (!res.ok) {
        getLogger().info(
          { url, status: res.status },
          "starter kits: compare for a kit update was refused",
        );
        return null;
      }
      const text = await readTextWithin(res, MAX_COMPARE_BYTES);
      if (text === null) return null;
      const body = JSON.parse(text) as CompareBody;
      const commits: KitUpdateCommit[] = (body.commits ?? [])
        .slice(-MAX_COMMITS)
        .reverse()
        .map((c) => ({
          sha: c.sha,
          subject: (c.commit?.message ?? "").split("\n")[0] ?? "",
        }));
      return { commits, total: body.total_commits ?? commits.length };
    } catch {
      return null;
    }
  }

  async function readChanges(
    url: string,
    from: string,
    to: string,
  ): Promise<KitUpdateChanges> {
    const repo = deps.hosts.locate(url);
    const compareUrl = `${repo?.gitUrl ?? url}/compare/${from}...${to}`;
    const [versionFrom, versionTo, changelogText] = await Promise.all([
      readVersion(url, from),
      readVersion(url, to),
      createGitCatalogSource(deps.hosts, url, to, fetchImpl)
        .readText("CHANGELOG.md")
        .catch(() => null),
    ]);
    const changelog =
      changelogText && versionFrom && versionTo
        ? changelogBetween(changelogText, versionFrom, versionTo)
        : null;
    const compared = changelog ? null : await readCommits(url, from, to);
    return {
      from,
      to,
      compareUrl,
      versionFrom,
      versionTo,
      changelog,
      commits: compared?.commits ?? null,
      totalCommits: compared?.total ?? null,
    };
  }

  return {
    async head(url, branch) {
      const key = `${url}#${branch ?? ""}`;
      const entry = heads.get(key);
      const age = entry ? now() - entry.readAt : Infinity;
      if (entry && age < FRESH_TTL_MS) return entry.value;
      if (entry && age < STALE_TTL_MS) {
        void readHead(key, url, branch);
        return entry.value;
      }
      return readHead(key, url, branch);
    },

    changes(url, from, to) {
      const key = `${url}#${from}...${to}`;
      const cached = changesCache.get(key);
      if (cached) return cached;
      if (changesCache.size >= MAX_CHANGES_ENTRIES) changesCache.clear();
      const read = readChanges(url, from, to);
      changesCache.set(key, read);
      read.then(
        (c) => {
          if (!c.changelog && !c.commits) changesCache.delete(key);
        },
        () => changesCache.delete(key),
      );
      return read;
    },
  };
}
