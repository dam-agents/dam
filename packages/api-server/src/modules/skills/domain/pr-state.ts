export type PrState = "draft" | "open" | "merged" | "closed";

export interface PrDisposition {
  state: "open" | "closed";
  draft: boolean;
  mergedAt: string | null;
}

export type PodPrReadResult =
  | { kind: "state"; disposition: PrDisposition }
  | { kind: "not-running" }
  | { kind: "failed" };

export interface PodPrStateReader {
  read(
    agentId: string,
    coords: { owner: string; repo: string; number: number },
  ): Promise<PodPrReadResult>;
}

export function derivePrState(d: PrDisposition): PrState {
  if (d.mergedAt !== null) return "merged";
  if (d.state === "closed") return "closed";
  return d.draft ? "draft" : "open";
}
