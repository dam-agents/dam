import { jwtVerify, type JWTVerifyGetKey } from "jose";

// UNIT_BOUNDARY_DESCRIPTION: the path an OAuth client asks an Environment address for what protects it (RFC 9728), answered by the gate, never the app; a suffixed form names a path of the address, which shares the same metadata.
export const RESOURCE_METADATA_PATH = "/.well-known/oauth-protected-resource";

// UNIT_BOUNDARY_DESCRIPTION: the scopes a client asks the identity provider for an Environment: `environments` for a token bound to one address, `offline_access` so the sign-in outlives the person's browser session and each sign-in keeps its own address.
export const ENVIRONMENT_SCOPES = ["environments", "offline_access"] as const;

// UNIT_BOUNDARY_DESCRIPTION: how long a request with a valid token waits for a sleeping Environment to wake before it gets the gate's 503, so a connected client's call answers once the machine runs instead of failing at once.
export const WAKE_WAIT_MS = 60_000;

// UNIT_BOUNDARY_DESCRIPTION: what an OAuth client needs to know to get a token for one address: the address itself as the resource, the identity provider that issues tokens for it, and the scopes to ask.
export interface ResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: ["header"];
  resource_name: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Environment endpoint's address as an OAuth
 * client compares it with the resource a token names: the install's scheme,
 * the endpoint's host under the environments domain, its port only when the
 * install's URL has one, and no trailing slash. The identity provider's
 * extension accepts exactly this form, so the two agree byte for byte.
 */
export function resourceOf(
  address: string,
  opts: { scheme: "http" | "https"; domain: string; port: number | null },
): string {
  return `${opts.scheme}://${address}.${opts.domain}${opts.port === null ? "" : `:${opts.port}`}`;
}

export function resourceMetadata(
  resource: string,
  issuer: string,
  brandName: string,
): ResourceMetadata {
  return {
    resource,
    authorization_servers: [issuer],
    scopes_supported: [...ENVIRONMENT_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: `${brandName} Environment`,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the header a 401 at an Environment address carries, pointing a client at the resource metadata and the scopes it needs (RFC 9728 §5.1, RFC 6750 §3); a token that failed the check says so in `error`.
export function wwwAuthenticate(
  resource: string,
  error?: "invalid_token",
): string {
  const parts = [
    `resource_metadata="${resource}${RESOURCE_METADATA_PATH}"`,
    `scope="${ENVIRONMENT_SCOPES.join(" ")}"`,
  ];
  if (error) parts.unshift(`error="${error}"`);
  return `Bearer ${parts.join(", ")}`;
}

// UNIT_BOUNDARY_DESCRIPTION: whether a path is the resource metadata, bare or suffixed with a path of the address, as RFC 9728 §3.1 lets a client ask.
export function isResourceMetadataPath(path: string): boolean {
  return (
    path === RESOURCE_METADATA_PATH ||
    path.startsWith(`${RESOURCE_METADATA_PATH}/`)
  );
}

// UNIT_BOUNDARY_DESCRIPTION: a bearer token's person, as the gate reads one for the same access rule a browser session gets: the owner by `sub`, anyone else by an email the identity provider verified.
export interface BearerVisitor {
  sub: string;
  email: string | null;
}

export type BearerCheck =
  | { kind: "none" }
  | { kind: "invalid" }
  | { kind: "valid"; visitor: BearerVisitor };

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads the `Authorization` header of a request
 * to an Environment address. A bearer JWT that names one of the platform's
 * issuers is checked: RS256 against the identity provider's keys, that
 * issuer, an audience of exactly this address and nothing else, and its
 * expiry; then its person is read, with an email only when it is verified.
 * Any other header, or none, is not the gate's: the request is judged as it
 * was before, and the relay keeps dropping platform tokens. A token of the
 * platform that fails any check is invalid, never let through.
 */
export async function checkBearer(
  header: string | undefined,
  opts: {
    resource: string;
    issuers: readonly string[];
    keys: JWTVerifyGetKey;
  },
): Promise<BearerCheck> {
  const match = header ? /^\s*bearer\s+(\S+)\s*$/i.exec(header) : null;
  if (!match) return { kind: "none" };
  const token = match[1]!;
  const issuer = unverifiedIssuer(token);
  if (issuer === undefined || !opts.issuers.includes(issuer))
    return { kind: "none" };
  try {
    const { payload } = await jwtVerify(token, opts.keys, {
      issuer,
      algorithms: ["RS256"],
      requiredClaims: ["exp", "sub", "aud"],
    });
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (audience.length !== 1 || audience[0] !== opts.resource)
      return { kind: "invalid" };
    const email =
      payload.email_verified === true && typeof payload.email === "string"
        ? payload.email
        : null;
    return { kind: "valid", visitor: { sub: payload.sub!, email } };
  } catch {
    return { kind: "invalid" };
  }
}

function unverifiedIssuer(token: string): string | undefined {
  const parts = token.split(".");
  if (parts.length !== 3) return undefined;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    );
    return claims !== null &&
      typeof claims === "object" &&
      "iss" in claims &&
      typeof claims.iss === "string"
      ? claims.iss
      : undefined;
  } catch {
    return undefined;
  }
}
