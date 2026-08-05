export type PrState = "draft" | "open" | "merged" | "closed";

/** The three fields GitHub reports about a pull request's disposition. */
export interface PrDisposition {
  state: "open" | "closed";
  draft: boolean;
  mergedAt: string | null;
}

/**
 * Authenticated read through the owning agent's own pod — the only way a
 * private source resolves, since the token lives as a gateway injection paired
 * with that agent.
 *
 * The port is declared here rather than beside the service so the adapter can
 * implement it without infrastructure importing from services.
 */
export interface PodPrStateReader {
  /** Null when the read is not possible — the agent is not *already* running,
   *  or the call failed. Not an error: the record stays unresolved and its
   *  badge says so. Implementations must never wake a hibernated agent. */
  read(
    agentId: string,
    coords: { owner: string; repo: string; number: number },
  ): Promise<PrDisposition | null>;
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
