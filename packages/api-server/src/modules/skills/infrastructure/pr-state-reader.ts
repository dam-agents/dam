import { derivePrState, type PrState } from "../domain/pr-state.js";
import type { PrCoordinates } from "../domain/pr-url.js";

/** GitHub rejects API requests without a User-Agent. */
const USER_AGENT = "platform-pr-state-resolver";

export type PrStateReadResult =
  | { kind: "state"; prState: PrState; etag: string | null }
  /** The cached state still stands. Note this did NOT come for free — see the
   *  factory's note on the rate limit. */
  | { kind: "notModified" }
  | { kind: "unavailable"; reason: "not-found" | "rate-limited" | "error" };

export interface PrStateReader {
  /** Conditional read of one pull request. Never throws — a badge that cannot
   *  be resolved is a normal outcome, not a fault. */
  read(coords: PrCoordinates, etag: string | null): Promise<PrStateReadResult>;
}

/**
 * Anonymous reader over `api.github.com`. Anonymous is the point: it carries
 * no credential, so the invariant that only agent-runtime talks to GitHub
 * *with* credentials is untouched. The cost is a 60-requests/hour-per-IP
 * ceiling shared by every user of this api-server.
 *
 * `If-None-Match` is sent when a validator is known, but do **not** mistake it
 * for a budget mechanism: an anonymous 304 decrements
 * `x-ratelimit-remaining` by one exactly like a 200 (measured — GitHub's
 * "conditional requests are free" rule covers the authenticated primary limit,
 * not this bucket). It saves bandwidth only. The caller's per-record hourly
 * re-check is what keeps the pass inside the ceiling.
 */
export function createGitHubPrStateReader(): PrStateReader {
  return {
    async read(coords, etag) {
      const url = `https://api.github.com/repos/${coords.owner}/${coords.repo}/pulls/${coords.number}`;
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": USER_AGENT,
            ...(etag ? { "If-None-Match": etag } : {}),
          },
        });
      } catch {
        return { kind: "unavailable", reason: "error" };
      }

      if (res.status === 304) return { kind: "notModified" };
      // 404 is as much "private" as "gone" — either way it is not resolvable
      // anonymously, which is cheaper than pre-classifying the source.
      if (res.status === 404)
        return { kind: "unavailable", reason: "not-found" };
      if (
        (res.status === 403 || res.status === 429) &&
        res.headers.get("x-ratelimit-remaining") === "0"
      ) {
        return { kind: "unavailable", reason: "rate-limited" };
      }
      if (!res.ok) return { kind: "unavailable", reason: "error" };

      let body: { state?: string; draft?: boolean; merged_at?: string | null };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        return { kind: "unavailable", reason: "error" };
      }
      if (body.state !== "open" && body.state !== "closed") {
        return { kind: "unavailable", reason: "error" };
      }
      return {
        kind: "state",
        prState: derivePrState({
          state: body.state,
          draft: body.draft ?? false,
          mergedAt: body.merged_at ?? null,
        }),
        etag: res.headers.get("etag"),
      };
    },
  };
}
