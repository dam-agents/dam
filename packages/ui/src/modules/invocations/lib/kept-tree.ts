import type { EnvironmentView, KeptSubAgent } from "api-server-api";

// UNIT_BOUNDARY_DESCRIPTION: the part of the kept tree a search shows: a kept sub-agent whose name holds the term, with everything under it; above it, the kept sub-agents it hangs from; and an Environment whose name holds the term, with the sub-agents it hangs from. Without a term, the whole tree.
export function visibleKeptTree(
  subAgents: readonly KeptSubAgent[],
  environments: readonly EnvironmentView[],
  term: string,
): { subAgents: KeptSubAgent[]; environments: EnvironmentView[] } {
  if (term === "")
    return { subAgents: [...subAgents], environments: [...environments] };
  const byId = new Map(subAgents.map((s) => [s.id, s]));
  const named = (s: KeptSubAgent) =>
    (s.label ?? s.id).toLowerCase().includes(term);
  const underMatch = (id: string | null): boolean => {
    for (
      let s = id ? byId.get(id) : undefined;
      s;
      s = byId.get(s.parentId ?? "")
    )
      if (named(s)) return true;
    return false;
  };
  const shownEnvironments = environments.filter(
    (e) =>
      byId.has(e.owningAgentId) &&
      (e.name.toLowerCase().includes(term) || underMatch(e.owningAgentId)),
  );
  const shown = new Set<string>();
  const withAncestors = (id: string | null) => {
    for (
      let s = id ? byId.get(id) : undefined;
      s && !shown.has(s.id);
      s = byId.get(s.parentId ?? "")
    )
      shown.add(s.id);
  };
  for (const s of subAgents) if (underMatch(s.id)) withAncestors(s.id);
  for (const e of shownEnvironments) withAncestors(e.owningAgentId);
  return {
    subAgents: subAgents.filter((s) => shown.has(s.id)),
    environments: shownEnvironments,
  };
}
