import type { InheritedEnv } from "../../sandboxes/hooks/use-inherited-envs.js";

// UNIT_BOUNDARY_DESCRIPTION: who contributes a variable, as the group the Services panel files it under: the platform's own, a provider's, or one connection's, each named so a reader knows where the value comes from without opening the group.
export function contributorOf(source: InheritedEnv["source"]): {
  key: string;
  title: string;
} {
  if (source === "system")
    return { key: "platform", title: "From the platform" };
  return {
    key: `${source.kind}:${source.label}`,
    title: `From the ${source.kind} ${source.label}`,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: a search matches a variable's name or its value, whatever the case, and an empty search keeps every one of them.
export function matchesEnvQuery(
  query: string,
  entry: { name: string; value: string },
): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle === "" ||
    entry.name.toLowerCase().includes(needle) ||
    entry.value.toLowerCase().includes(needle)
  );
}
