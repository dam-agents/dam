import type { EgressRuleSource, EgressRuleView } from "./types.js";

/**
 * Non-null for every variant — callers that want to hide manual rows check
 * `source === "manual"` explicitly.
 */
export function formatEgressRuleSource(source: EgressRuleSource): string {
  if (source === "manual") return "manual";
  if (source === "inbox") return "from inbox";
  if (source === "preset:trusted") return "preset: trusted";
  if (source === "preset:all") return "preset: all";
  if (source.startsWith("connection:")) {
    return `from ${source.slice("connection:".length)}`;
  }
  return source;
}

/** `<verdict> [<method>] <host>[<path>]` — wildcard method/path suppressed. */
export function formatEgressRuleInline(
  rule: Pick<EgressRuleView, "verdict" | "method" | "host" | "pathPattern">,
): string {
  const parts: string[] = [rule.verdict];
  if (rule.method !== "*") parts.push(rule.method);
  parts.push(joinHostPath(rule.host, rule.pathPattern));
  return parts.join(" ");
}

function joinHostPath(host: string, pathPattern: string): string {
  const normalizedHost = host.replace(/\/+$/, "");
  if (pathPattern === "*") return normalizedHost;
  const normalizedPath = pathPattern.startsWith("/")
    ? pathPattern
    : `/${pathPattern}`;
  return `${normalizedHost}${normalizedPath}`;
}
