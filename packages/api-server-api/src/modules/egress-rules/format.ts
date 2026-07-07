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

/** `<verdict> [<method>] <host>[:<port>][<path>]` — wildcard method/path
 *  and the default port suppressed. */
export function formatEgressRuleInline(
  rule: Pick<
    EgressRuleView,
    "verdict" | "method" | "host" | "port" | "pathPattern"
  >,
): string {
  const parts: string[] = [rule.verdict];
  if (rule.method !== "*") parts.push(rule.method);
  parts.push(joinHostPath(rule.host, rule.pathPattern, rule.port));
  return parts.join(" ");
}

function joinHostPath(
  host: string,
  pathPattern: string,
  port?: number,
): string {
  const normalizedHost = stripTrailingSlashes(host) + (port ? `:${port}` : "");
  if (pathPattern === "*") return normalizedHost;
  const normalizedPath = pathPattern.startsWith("/")
    ? pathPattern
    : `/${pathPattern}`;
  return `${normalizedHost}${normalizedPath}`;
}

// Index-based, not `/\/+$/` — that regex is quadratic on user-typed input.
function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === "/") end--;
  return s.slice(0, end);
}
