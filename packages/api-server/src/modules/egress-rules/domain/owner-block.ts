import { hostMatchCandidates } from "./host-match.js";

interface BlockRule {
  host: string;
  port?: number;
  method: string;
  pathPattern: string;
}

const hostRank = (pattern: string): number =>
  pattern === "*" ? 2 : pattern.startsWith("*.") ? 1 : 0;

const portOf = (port: number | undefined): readonly number[] =>
  port === undefined ? [443, 80] : [port];

// Two path patterns whose literal text before the first `*` differs, neither a prefix of the other, can match no path in common; any other pair is read as overlapping. Compared without case, as a GitHub deny is.
function pathsMayOverlap(a: string, b: string): boolean {
  const prefixOf = (p: string) => p.split("*")[0]!.toLowerCase();
  const [pa, pb] = [prefixOf(a), prefixOf(b)];
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// The gate's ORDER BY: the more specific host pattern, then a named method, then a named path, then the longer path.
function ranksBefore(block: BlockRule, allow: BlockRule): boolean {
  const [hb, ha] = [hostRank(block.host), hostRank(allow.host)];
  if (hb !== ha) return hb < ha;
  if ((block.method === "*") !== (allow.method === "*"))
    return block.method !== "*";
  if ((block.pathPattern === "*") !== (allow.pathPattern === "*"))
    return block.pathPattern !== "*";
  return block.pathPattern.length > allow.pathPattern.length;
}

// UNIT_BOUNDARY_DESCRIPTION: whether a driver's allow rule on its open child would let through a request that a block the owner set on the child stops, which a block being the owner's alone forbids. It would when the block speaks for the allow's host (the host, its `*.parent` or `*`) on a port both speak for, for a method and paths both may match, and the gate does not rank the block first: a host-wide block is beaten by any allow for a named method or path, and a tie is read as beaten.
export function allowBeatsBlock(
  allow: BlockRule,
  block: BlockRule,
): boolean {
  const host = allow.host.trim().toLowerCase();
  const blockHost = block.host.trim().toLowerCase();
  if (!hostMatchCandidates(host).includes(blockHost)) return false;
  if (!portOf(allow.port).some((p) => portOf(block.port).includes(p)))
    return false;
  if (
    allow.method !== "*" &&
    block.method !== "*" &&
    allow.method !== block.method
  )
    return false;
  if (!pathsMayOverlap(allow.pathPattern, block.pathPattern)) return false;
  return !ranksBefore({ ...block, host: blockHost }, { ...allow, host });
}
