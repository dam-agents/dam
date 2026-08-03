export type PrState = "draft" | "open" | "merged" | "closed";

/** The three fields GitHub reports about a pull request's disposition. */
export interface PrDisposition {
  state: "open" | "closed";
  draft: boolean;
  mergedAt: string | null;
}

/**
 * The one place `draft | open | merged | closed` is derived, shared by the
 * anonymous api-server read and the authenticated read through a warm pod.
 *
 * Order is what carries the meaning: a merged pull request also reports
 * `state: "closed"`, so testing `mergedAt` before `closed` is what
 * distinguishes landed from abandoned, and a draft is open too.
 */
export function derivePrState(d: PrDisposition): PrState {
  if (d.mergedAt !== null) return "merged";
  if (d.state === "closed") return "closed";
  return d.draft ? "draft" : "open";
}
