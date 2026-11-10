import { ranksBefore } from "./gate-order.js";

interface BlockRule {
  host: string;
  port?: number;
  method: string;
  pathPattern: string;
}

const portOf = (port: number | undefined): readonly number[] =>
  port === undefined ? [443, 80] : [port];

// UNIT_BOUNDARY_DESCRIPTION: two path patterns whose literal text before the first `*` differs, neither a prefix of the other, can match no path in common; any other pair is read as overlapping. Compared without case, as a GitHub deny is.
function pathsMayOverlap(a: string, b: string): boolean {
  const prefixOf = (p: string) => p.split("*")[0]!.toLowerCase();
  const [pa, pb] = [prefixOf(a), prefixOf(b)];
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// UNIT_BOUNDARY_DESCRIPTION: whether a driver's allow rule on its open child would undo a block the owner set on the child, which a block being the owner's alone forbids. It would when both name the same host pattern, a port both speak for, and a method and paths both may match, and the gate does not rank the block first: a host-wide block is beaten by any allow for a named method or path, and a tie is read as beaten. A block of a wildcard (`*` or `*.example.com`, written by hand) stops only an allow of that wildcard: the gate ranks a named host before it, so the block says "not any host", and whether the driver may give the named host is the reach check's to decide.
export function allowBeatsBlock(allow: BlockRule, block: BlockRule): boolean {
  if (allow.host.trim().toLowerCase() !== block.host.trim().toLowerCase())
    return false;
  if (!portOf(allow.port).some((p) => portOf(block.port).includes(p)))
    return false;
  if (
    allow.method !== "*" &&
    block.method !== "*" &&
    allow.method !== block.method
  )
    return false;
  if (!pathsMayOverlap(allow.pathPattern, block.pathPattern)) return false;
  return !ranksBefore(block, allow);
}
