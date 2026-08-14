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

export function scanFailureMessage(failure: ScanFailure): string {
  const title = /[.!?]$/.test(failure.title)
    ? failure.title
    : `${failure.title}.`;
  return `${title} ${failure.detail}`;
}
