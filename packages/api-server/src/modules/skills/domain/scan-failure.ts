import type { SourcePathReason } from "agent-runtime-api";
import type { ScanFailure, ScanFailureCode } from "api-server-api";

const COPY: Record<ScanFailureCode, Omit<ScanFailure, "code">> = {
  needs_github_connection: {
    title: "Can't load skills from this source",
    detail:
      "The repository may be private or the URL may not be valid. " +
      "Add a GitHub connection or check the URL, then re-scan.",
  },
  needs_sandbox: {
    title: "This source needs a sandbox to scan it",
    detail:
      "The repository isn't public, so reading it requires a running sandbox's GitHub connection.",
  },
  repo_unreachable: {
    title: "Can't load skills from this source",
    detail:
      "Your GitHub connection may not have access to this repository, or the URL may not be valid. " +
      "Grant your GitHub connection access to it or check the URL, then re-scan.",
  },
  agent_unreachable: {
    title: "Couldn't reach this sandbox",
    detail:
      "The sandbox couldn't be reached to scan this source. Try re-scanning in a moment.",
  },
  source_path_not_found: {
    title: "This source's path isn't in the repository",
    detail:
      "The path configured on this source doesn't exist in the repository. " +
      "Remove the source and add it again with the correct path, or with none.",
  },
  source_path_empty: {
    title: "No skills under this source's path",
    detail:
      "The path configured on this source exists but holds no skill. " +
      "Skills are found one level below the path. " +
      "Remove the source and add it again with the correct path, or with none.",
  },
  other: {
    title: "Can't load skills from this source",
    detail:
      "Something went wrong reading this repository. Try re-scanning in a moment.",
  },
};

export function scanFailure(
  code: ScanFailureCode,
  override?: Partial<Omit<ScanFailure, "code">>,
): ScanFailure {
  return { code, ...COPY[code], ...override };
}

export function sourcePathFailure(
  reason: SourcePathReason,
  ctx: { path: string; version?: string },
): ScanFailure {
  const at = ctx.version ? ` at commit ${ctx.version.slice(0, 7)}` : "";
  const where = `the repository${at}`;
  const detail =
    reason === "path-missing"
      ? `The path ${JSON.stringify(ctx.path)} isn't a directory in ${where}. ` +
        "Remove the source and add it again with the correct path, or with none."
      : `The path ${JSON.stringify(ctx.path)} is a directory in ${where}, but holds no skill. ` +
        "Skills are found one level below the path. " +
        "Remove the source and add it again with the correct path, or with none.";
  return scanFailure(
    reason === "path-missing" ? "source_path_not_found" : "source_path_empty",
    { detail },
  );
}

export function scanFailureMessage(failure: ScanFailure): string {
  const title = /[.!?]$/.test(failure.title)
    ? failure.title
    : `${failure.title}.`;
  return `${title} ${failure.detail}`;
}
