import { detectHost } from "./git-host.js";

export interface PrCoordinates {
  owner: string;
  repo: string;
  number: number;
}

export function parsePrUrl(prUrl: string): PrCoordinates | null {
  const m = /^(.*)\/pull\/(\d+)$/.exec(prUrl.replace(/\/+$/, ""));
  if (!m) return null;
  const host = detectHost(m[1]);
  if (!host) return null;
  return { owner: host.owner, repo: host.repo, number: Number(m[2]) };
}
