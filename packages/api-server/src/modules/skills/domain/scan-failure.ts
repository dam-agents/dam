import type { ScanFailure, ScanFailureCode } from "api-server-api";

/**
 * The user-facing copy for every verdict a failed scan can carry. The set is
 * closed on purpose: the scan path classifies into it exhaustively, so no
 * internal error text can reach a source card.
 *
 * `other` is the backstop. It is still a verdict — the copy tells the user what
 * to do — but it names no cause, because the server could not determine one.
 */
const COPY: Record<ScanFailureCode, Omit<ScanFailure, "code">> = {
  // The second sentence is the one hedge this verdict needs: a repository that
  // does not exist is indistinguishable from a private one we have no
  // credential for, so a mistyped URL lands here too and no connection will
  // ever fix it.
  needs_github_connection: {
    title: "This source needs a GitHub connection",
    detail:
      "Add a GitHub connection to this sandbox, then re-scan to list its skills. " +
      "If the repository should be public, check the URL instead.",
  },
  needs_sandbox: {
    title: "This source needs a sandbox to scan it",
    detail:
      "The repository isn't public, so reading it requires a running sandbox's GitHub connection.",
  },
  repo_unreachable: {
    title: "Can't access this repository",
    detail:
      "If it's private, grant your GitHub connection access to it, then re-scan — " +
      "otherwise, double-check the repo URL.",
  },
  agent_unreachable: {
    title: "Couldn't reach this sandbox",
    detail:
      "The sandbox couldn't be reached to scan this source. Try re-scanning in a moment.",
  },
  other: {
    title: "Couldn't scan this source",
    detail:
      "Something went wrong reading this repository. Try re-scanning in a moment.",
  },
};

/** `override` exists for the one-off verdicts that fall under `other` but have
 *  copy of their own — a named fix beats the generic one wherever we have it. */
export function scanFailure(
  code: ScanFailureCode,
  override?: Partial<Omit<ScanFailure, "code">>,
): ScanFailure {
  return { code, ...COPY[code], ...override };
}

/** The sentence for the consumers that only have an error message — the CLI
 *  prints it, and it is what lands in api-server logs. Titles are headings and
 *  carry no terminal punctuation, so one is added when flattening. */
export function scanFailureMessage(failure: ScanFailure): string {
  const title = /[.!?]$/.test(failure.title)
    ? failure.title
    : `${failure.title}.`;
  return `${title} ${failure.detail}`;
}
