import {
  canonicalEgressHost,
  PROVIDER_TEMPLATE_IDS,
  type Connection,
} from "api-server-api";

export interface ProviderEgressScope {
  readonly host: string;
  readonly port?: number;
  readonly pathPattern: string;
}

export interface ProviderEgressRequest {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
  readonly path: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the hosts an Agent's model provider Connections
 * carry credentials to. A model call that fails at the egress gate ends the
 * session, so these scopes pass the gate even when an egress rule of the
 * Agent denies the same host — a rule written while another provider was
 * attached must not break the provider attached now.
 */
export function providerEgressScopes(
  connections: readonly Pick<Connection, "templateId" | "contributions">[],
): ProviderEgressScope[] {
  return connections
    .filter((c) => PROVIDER_TEMPLATE_IDS.has(c.templateId))
    .flatMap((c) => c.contributions)
    .flatMap((c) =>
      c.kind === "egress-allow" ||
      c.kind === "egress-inject" ||
      c.kind === "egress-sign"
        ? [
            {
              host: canonicalEgressHost(c.host),
              ...(c.port ? { port: c.port } : {}),
              pathPattern: c.pathPattern || "*",
            },
          ]
        : [],
    );
}

export function scopeCovers(
  scope: ProviderEgressScope,
  request: ProviderEgressRequest,
): boolean {
  return (
    scope.host === canonicalEgressHost(request.host) &&
    (scope.port ?? (request.tls ? 443 : 80)) === request.port &&
    pathMatches(scope.pathPattern, request.path)
  );
}

function pathMatches(pattern: string, path: string): boolean {
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}$`, "s").test(path);
}
