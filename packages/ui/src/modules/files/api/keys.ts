export const fileKeys = {
  root: (agentId: string) => ["files", agentId] as const,
  /** Prefix for any tree snapshot. Use this for invalidation so it matches
   *  every `treeForPaths` entry under the same agent regardless of which
   *  paths set it was fetched with. */
  tree: (agentId: string) => [...fileKeys.root(agentId), "tree"] as const,
  /** Full key including the sorted paths set. The paths array is the query's
   *  declared input — changing it produces a new cache entry and a fresh
   *  fetch falls out of React Query's key-as-inputs model. */
  treeForPaths: (agentId: string, paths: readonly string[]) =>
    [...fileKeys.tree(agentId), paths] as const,
  content: (agentId: string, path: string) =>
    [...fileKeys.root(agentId), "content", path] as const,
};
