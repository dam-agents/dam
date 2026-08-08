import type { ScanFailure, ScanFailureCode } from "api-server-api";

/**
 * The user-facing copy for every verdict a failed scan can carry. The set is
 * closed on purpose: the scan path classifies into it exhaustively, so no
 * internal error text can reach a source card.
 *
 * Every source-scan verdict shares one title on purpose: the title states the
 * outcome, which is the same however the scan failed, and the body carries the
 * cause and its fix. A title that named the cause would assert a diagnosis the
 * server cannot be sure of — a missing connection and a mistyped URL are the
 * same 404. The sandbox verdicts are a different class and keep their own.
 *
 * `other` is the backstop. It is still a verdict — the copy tells the user what
 * to do — but it names no cause, because the server could not determine one.
 */
const COPY: Record<ScanFailureCode, Omit<ScanFailure, "code">> = {
  // Deliberately hedged rather than confident: a repository that does not
  // exist is indistinguishable from a private one we hold no credential for,
  // so a mistyped URL lands here too and no connection would ever fix it.
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
