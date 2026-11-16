import { canonicalEgressHost } from "api-server-api";
import { hostMatchCandidates } from "./host-match.js";
import { rulePortCovers } from "./port-match.js";

interface SpokenRule {
  host: string;
  port?: number;
  method: string;
  pathPattern: string;
}

interface SpokenRequest {
  host: string;
  port: number;
  tls: boolean;
  method: string;
  path: string;
}

const REGEX_CHARS = /[.+?^${}()|[\]\\]/g;

function pathMatches(pathPattern: string, path: string): boolean {
  const body = pathPattern
    .replace(REGEX_CHARS, "\\$&")
    .replace(/[*%]/g, "[\\s\\S]*")
    .replaceAll("_", "[\\s\\S]");
  return new RegExp(`^${body}$`).test(path);
}

// UNIT_BOUNDARY_DESCRIPTION: whether a rule that is not written yet would speak for a request once it is, read as the gate's own lookup reads a stored rule: the host itself or the wildcard one label above it, the port the rule names (or the scheme's default), the method or `*`, and the path pattern with LIKE's wildcards (`*` and `%` any run of characters, `_` any one). The gate asks this of a child's rule that waits for its owner, to hold a request the rule would allow instead of refusing it.
export function ruleSpeaksFor(
  rule: SpokenRule,
  request: SpokenRequest,
): boolean {
  return (
    hostMatchCandidates(canonicalEgressHost(request.host)).includes(
      rule.host.trim().toLowerCase(),
    ) &&
    rulePortCovers(rule.port, request.port, request.tls) &&
    (rule.method === "*" || rule.method === request.method) &&
    pathMatches(rule.pathPattern, request.path)
  );
}
