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
