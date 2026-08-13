export const fileKeys = {
  root: (agentId: string) => ["files", agentId] as const,
  tree: (agentId: string) => [...fileKeys.root(agentId), "tree"] as const,
  treeForPaths: (agentId: string, paths: readonly string[]) =>
    [...fileKeys.tree(agentId), paths] as const,
  content: (agentId: string, path: string) =>
    [...fileKeys.root(agentId), "content", path] as const,
};
