import { type ScanFailure, scanFailureSchema } from "api-server-api";

/** Verdicts a "Manage connections" affordance can actually resolve. On any
 *  other failure the link sends the user somewhere that cannot help. */
const CONNECTION_VERDICTS: ReadonlySet<ScanFailure["code"]> = new Set([
  "needs_github_connection",
  "repo_unreachable",
]);

export function isConnectionFailure(failure: ScanFailure): boolean {
  return CONNECTION_VERDICTS.has(failure.code);
}

/** What the card shows when the server reached no verdict of its own. Reaching
 *  for the raw error message here is the defect this replaces: a response that
 *  never made it through the server's classifier carries transport text, and a
 *  parser's complaint is not something a user can act on.
 *
 *  Deliberately word-for-word the server's own generic verdict: a failure that
 *  died in transit and one the server classified as unknown are the same event
 *  to the user, so they must not read differently. */
const UNCLASSIFIED: ScanFailure = {
  code: "other",
  title: "Can't load skills from this source",
  detail:
    "Something went wrong reading this repository. Try re-scanning in a moment.",
};

/**
 * The verdict a failed scan carries, or the generic one when it carries none.
 *
 * The server attaches `scanFailure` to every failure it classified, so its
 * absence means the response never got that far — a gateway error page, a
 * dropped connection, a batched request that failed as a whole.
 */
export function toScanFailure(err: unknown): ScanFailure {
  const data = (err as { data?: unknown })?.data;
  if (!data || typeof data !== "object" || !("scanFailure" in data)) {
    return UNCLASSIFIED;
  }
  const parsed = scanFailureSchema.safeParse(data.scanFailure);
  return parsed.success ? parsed.data : UNCLASSIFIED;
}
