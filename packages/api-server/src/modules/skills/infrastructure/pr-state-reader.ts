import { derivePrState, type PrState } from "../domain/pr-state.js";
import type { PrCoordinates } from "../domain/pr-url.js";

const USER_AGENT = "platform-pr-state-resolver";

export type PrStateReadResult =
  | { kind: "state"; prState: PrState; etag: string | null }
  | { kind: "notModified" }
  | { kind: "unavailable"; reason: "not-found" | "rate-limited" | "error" };

export interface PrStateReader {
  read(coords: PrCoordinates, etag: string | null): Promise<PrStateReadResult>;
}

export function createGitHubPrStateReader(): PrStateReader {
  return {
    async read(coords, etag) {
      const url = `https://api.github.com/repos/${encodeURIComponent(coords.owner)}/${encodeURIComponent(coords.repo)}/pulls/${coords.number}`;
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
