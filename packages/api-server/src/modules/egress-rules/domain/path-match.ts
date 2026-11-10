// UNIT_BOUNDARY_DESCRIPTION: whether a rule's path pattern matches every path a request carries, read as the gate reads it: `path LIKE replace(path_pattern, '*', '%')`, so `*` and `%` match any run of characters and `_` any one. A request's path is never empty and an inspected one starts with `/`, so `*`, `/*`, `**`, `%/*` and `_*` all match every path, and `/`, `/_*` or `/api/*` do not.
export function patternCoversEveryPath(pathPattern: string): boolean {
  const like = pathPattern.replaceAll("*", "%");
  if (/^%*\/%+$/.test(like)) return true;
  return /^%*_?%*$/.test(like) && like.includes("%");
}
