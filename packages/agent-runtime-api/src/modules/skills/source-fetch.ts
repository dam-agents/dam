import { parseGithubRepo } from "./git-url.js";

export const SOURCE_FETCH_MODES = ["directory"] as const;
export type SourceFetchMode = (typeof SOURCE_FETCH_MODES)[number];

export type SourceFetchPlan =
  | { kind: "archive" }
  | { kind: "directory" }
  | { kind: "blocked"; reason: "no-path" | "path-denied" };

export type EgressDenies = (
  host: string,
  method: string,
  path: string,
) => Promise<boolean>;

/* UNIT_BOUNDARY_DESCRIPTION: Decides how an agent's pod fetches a skill source from the agent's egress rules: the repository archive as before, only the source path's directory when the archive is denied, or nothing when the path is denied too or missing. */
export async function planSourceFetch(
  source: { url: string; path?: string; version: string },
  denies: EgressDenies,
): Promise<SourceFetchPlan> {
  const repo = parseGithubRepo(source.url);
  if (!repo) return { kind: "archive" };
  const { owner, repo: name } = repo;
  const [apiDenied, codeloadDenied] = await Promise.all([
    denies(
      "api.github.com",
      "GET",
      `/repos/${owner}/${name}/tarball/${source.version}`,
    ),
    denies(
      "codeload.github.com",
      "GET",
      `/${owner}/${name}/legacy.tar.gz/${source.version}`,
    ),
  ]);
  if (!apiDenied && !codeloadDenied) return { kind: "archive" };
  const dir = source.path?.split("/").filter(Boolean).join("/");
  if (!dir) return { kind: "blocked", reason: "no-path" };
  const contentsDenied = await denies(
    "api.github.com",
    "GET",
    `/repos/${owner}/${name}/contents/${dir}?ref=${source.version}`,
  );
  return contentsDenied
    ? { kind: "blocked", reason: "path-denied" }
    : { kind: "directory" };
}
