interface OrderedRule {
  method: string;
  pathPattern: string;
}

// UNIT_BOUNDARY_DESCRIPTION: whether a rule's path pattern matches every path a request carries, read as the gate reads it: `path LIKE replace(path_pattern, '*', '%')`, so `*` and `%` match any run of characters and `_` any one. A request's path is never empty and an inspected one starts with `/`, so `*`, `/*`, `**`, `%/*` and `_*` all match every path, and `/`, `/_*` or `/api/*` do not.
export function patternCoversEveryPath(pathPattern: string): boolean {
  const like = pathPattern.replaceAll("*", "%");
  if (/^%*\/%+$/.test(like)) return true;
  return /^%*_?%*$/.test(like) && like.includes("%");
}

// UNIT_BOUNDARY_DESCRIPTION: whether the gate tries rule `a` strictly before rule `b` when both speak for a request under the same host pattern, as its ORDER BY does: a named method first, then a named path, then the longer path. Equal ranks are a tie the gate breaks in no fixed order, so a caller reads a tie the way that is safe for it.
export function ranksBefore(a: OrderedRule, b: OrderedRule): boolean {
  if ((a.method === "*") !== (b.method === "*")) return a.method !== "*";
  if ((a.pathPattern === "*") !== (b.pathPattern === "*"))
    return a.pathPattern !== "*";
  return a.pathPattern.length > b.pathPattern.length;
}

const literalPrefix = (pathPattern: string): string =>
  pathPattern.split(/[*%_]/)[0]!;

// UNIT_BOUNDARY_DESCRIPTION: whether two rules may speak for one request's method and path. Methods do when they are the same or one is `*`. Path patterns are read as overlapping unless their literal text before the first wildcard (`*`, `%` or `_`, as the gate's LIKE reads them) differs with neither a prefix of the other, compared without case, as a GitHub deny is. Overlap is the safe answer for a caller that must not miss one.
export function mayMatchOneRequest(a: OrderedRule, b: OrderedRule): boolean {
  if (a.method !== "*" && b.method !== "*" && a.method !== b.method)
    return false;
  const [pa, pb] = [
    literalPrefix(a.pathPattern).toLowerCase(),
    literalPrefix(b.pathPattern).toLowerCase(),
  ];
  return pa.startsWith(pb) || pb.startsWith(pa);
}

// UNIT_BOUNDARY_DESCRIPTION: whether rule `wide` speaks for every request rule `narrow` speaks for, under the same host pattern and port. Its method is `*` or the same one. Its path pattern matches every path, or is the same pattern, or is literal text with one trailing `*` that the other's literal text starts with. Any other pair is read as not covered, which is the safe answer for a caller that widens nothing on a doubt.
export function coversEveryRequestOf(
  wide: OrderedRule,
  narrow: OrderedRule,
): boolean {
  if (wide.method !== "*" && wide.method !== narrow.method) return false;
  if (patternCoversEveryPath(wide.pathPattern)) return true;
  if (wide.pathPattern === narrow.pathPattern) return true;
  const trailing = /^([^*%_]*)\*+$/.exec(wide.pathPattern);
  return (
    trailing !== null &&
    literalPrefix(narrow.pathPattern).startsWith(trailing[1]!)
  );
}
