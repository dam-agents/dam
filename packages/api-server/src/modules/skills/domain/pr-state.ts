export type PrState = "draft" | "open" | "merged" | "closed";

export interface PrDisposition {
  state: "open" | "closed";
  draft: boolean;
  mergedAt: string | null;
}

export type AgentPrReadResult =
  | { kind: "state"; disposition: PrDisposition }
  | { kind: "not-running" }
  | { kind: "failed" };

export interface AgentPrStateReader {
  read(
    agentId: string,
    coords: { owner: string; repo: string; number: number },
  ): Promise<AgentPrReadResult>;
}

export function derivePrState(d: PrDisposition): PrState {
  if (d.mergedAt !== null) return "merged";
  if (d.state === "closed") return "closed";
  return d.draft ? "draft" : "open";
}
