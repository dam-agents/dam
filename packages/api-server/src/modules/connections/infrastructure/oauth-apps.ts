/**
 * Static descriptors for the OAuth apps Humr knows how to drive — GitHub.com,
 * GitHub Enterprise, and a Generic app for arbitrary auth-code+PKCE
 * providers. Each descriptor declares the inputs the user must supply at
 * connect time (their own OAuth client id + secret, plus app-specific
 * fields) and a `build` function that turns those inputs into the
 * `OAuthFlowProvider` + `OAuthFlowMetadata` the engine needs.
 *
 * Client credentials live with the user by default — every user registers
 * their own OAuth app at the provider against the platform's callback URL.
 * **Optional admin defaults** (mirroring OneCLI's `GITHUB_CLIENT_ID` /
 * `GITHUB_CLIENT_SECRET` knobs) let an operator wire a single
 * platform-registered OAuth app: when a default is configured, the
 * matching field disappears from the connect form and the registry's
 * `build()` uses the default to mint tokens.
 *
 * Cardinality:
 * - **Single-instance** apps (github, github-enterprise) have at most one
 *   connection per user, keyed by the descriptor's `connectionKey`.
 * - **Multi-instance** apps (generic) can have many connections per user;
 *   `connectionKey` is a *prefix* and per-connection keys carry a stable
 *   suffix derived from the upstream host.
 */
import crypto from "node:crypto";
import { z } from "zod";

import { DEFAULT_ENV_PLACEHOLDER, type EnvMapping } from "api-server-api";

import {
  type OAuthFlowMetadata,
  type OAuthFlowProvider,
} from "./oauth-engine.js";

/**
 * Env vars set on agents that grant a GitHub.com or GHE connection. `gh` CLI
 * (and most token-aware GitHub tooling) reads `GH_TOKEN` from the env and
 * sends it as the bearer token; OneCLI's gateway recognizes the sentinel
 * placeholder and substitutes the real token on outbound requests matching
 * the secret's host pattern.
 */
const GH_TOKEN_ENV_MAPPING: EnvMapping = {
  envName: "GH_TOKEN",
  placeholder: DEFAULT_ENV_PLACEHOLDER,
};

export type OAuthAppId = "github" | "github-enterprise" | "generic";

export interface OAuthAppInputField {
  name: string;
  label: string;
  /** Render as a password input — never echo secret values back to the UI. */
  secret?: boolean;
  placeholder?: string;
  /** Short hint shown beneath the field. */
  helper?: string;
}

export type OAuthAppCardinality = "single" | "multiple";

export interface OAuthAppDescriptor {
  id: OAuthAppId;
  displayName: string;
  description: string;
  /**
   * "single" — at most one connection of this app per user. `connectionKey`
   * matches exactly. "multiple" — many connections per user; `connectionKey`
   * is a prefix and per-connection keys are `<prefix>-<suffix>`.
   */
  cardinality: OAuthAppCardinality;
  /** See `cardinality`. */
  connectionKey: string;
  /** The form fields the UI renders before kicking off the OAuth dance. */
  inputs: OAuthAppInputField[];
  /**
   * Helper link surfaced near the form to walk the user through registering
   * their own OAuth app at the provider.
   */
  registrationUrl?: string;
  /**
   * When set, the connect form runs RFC 8414 / OIDC issuer discovery against
   * the value of the named input field on blur, and auto-fills the
   * `authorizationUrl` and `tokenEndpoint` inputs (if they exist and are
   * empty). Generic uses this; static apps don't need it.
   */
  discoverFromHostField?: string;
}

export interface BuiltOAuthApp {
  provider: OAuthFlowProvider;
  flow: OAuthFlowMetadata;
  /** The display label the UI uses for this specific connection — for GHE,
   *  carries the host; for Generic, the user-supplied display name. */
  connectionDisplayName: string;
}

const DEFAULT_GITHUB_SCOPES = ["repo", "read:user", "user:email"];

const DESCRIPTORS: Record<OAuthAppId, OAuthAppDescriptor> = {
  github: {
    id: "github",
    displayName: "GitHub",
    description: "Connect github.com so agents can call the GitHub API on your behalf.",
    cardinality: "single",
    connectionKey: "github",
    registrationUrl: "https://github.com/settings/applications/new",
    inputs: [
      {
        name: "clientId",
        label: "Client ID",
        placeholder: "Iv1.…",
        helper: "From the OAuth app you registered on github.com.",
      },
      { name: "clientSecret", label: "Client secret", secret: true },
    ],
  },
  "github-enterprise": {
    id: "github-enterprise",
    displayName: "GitHub Enterprise",
    description: "Connect a GitHub Enterprise host so agents can call its API on your behalf.",
    cardinality: "single",
    connectionKey: "github-enterprise",
    inputs: [
      {
        name: "host",
        label: "Host",
        placeholder: "ghe.example.com",
        helper: "Hostname only — no scheme or trailing slash.",
      },
      { name: "clientId", label: "Client ID" },
      { name: "clientSecret", label: "Client secret", secret: true },
    ],
  },
  generic: {
    id: "generic",
    displayName: "Generic OAuth",
    description:
      "Connect any OAuth 2.1 authorization-code provider — supply the auth URL, token endpoint, and your client credentials.",
    cardinality: "multiple",
    connectionKey: "generic",
    discoverFromHostField: "hostPattern",
    inputs: [
      {
        name: "displayName",
        label: "Display name",
        placeholder: "e.g. Linear",
        helper: "Shown in the connections list.",
      },
      {
        name: "hostPattern",
        label: "Host",
        placeholder: "api.example.com",
        helper: "Hostname the credential injects on (no scheme).",
      },
      {
        name: "authorizationUrl",
        label: "Authorization URL",
        placeholder: "https://example.com/oauth/authorize",
      },
      {
        name: "tokenEndpoint",
        label: "Token endpoint",
        placeholder: "https://example.com/oauth/token",
      },
      {
        name: "scopes",
        label: "Scopes",
        placeholder: "openid profile email",
        helper:
          "Space-separated. For OIDC providers, include `offline_access` if you need a refresh token. Leave empty to omit the scope parameter.",
      },
      { name: "clientId", label: "Client ID" },
      { name: "clientSecret", label: "Client secret", secret: true },
    ],
  },
};

const githubInputSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
});

// RFC 1123 subdomain — same shape K8s names accept. Used both directly as a
// host and as input to Envoy SNI matching, so we apply it strictly here.
const HOSTNAME_RE =
  /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

const gheInputSchema = z.object({
  host: z
    .string()
    .min(1, "Host is required")
    .regex(HOSTNAME_RE, "Host must be a valid DNS hostname (no scheme)."),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

const httpsUrlSchema = z
  .string()
  .min(1)
  .refine((v) => /^https:\/\//.test(v), "Must be an https:// URL.");

const genericInputSchema = z.object({
  displayName: z.string().min(1, "Display name is required").max(80),
  hostPattern: z
    .string()
    .min(1, "Host is required")
    .regex(HOSTNAME_RE, "Host must be a valid DNS hostname (no scheme)."),
  authorizationUrl: httpsUrlSchema,
  tokenEndpoint: httpsUrlSchema,
  scopes: z.string().optional().default(""),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
});

export type GithubInput = z.infer<typeof githubInputSchema>;
export type GheInput = z.infer<typeof gheInputSchema>;
export type GenericInput = z.infer<typeof genericInputSchema>;

/**
 * Optional platform-wide defaults for OAuth app credentials. When a field
 * is set, the connect form's matching input disappears and `build()` uses
 * the default. Fields the admin doesn't set are required from the user.
 */
export interface OAuthAppDefaults {
  github?: {
    clientId?: string;
    clientSecret?: string;
  };
  githubEnterprise?: {
    host?: string;
    clientId?: string;
    clientSecret?: string;
  };
}

export interface OAuthAppRegistry {
  list(): OAuthAppDescriptor[];
  get(id: string): OAuthAppDescriptor | null;
  /**
   * Validate user-supplied form input against the app's schema and produce
   * the engine inputs. Throws on validation failure — caller maps to a 400.
   */
  build(id: OAuthAppId, rawInput: unknown): BuiltOAuthApp;
}

/**
 * Returns true when the given stored connection key belongs to this
 * descriptor. Single-instance apps match exactly; multi-instance apps
 * match by `<prefix>-<…>` shape.
 */
export function matchesAppConnection(
  descriptor: OAuthAppDescriptor,
  connectionKey: string,
): boolean {
  if (descriptor.cardinality === "single") {
    return connectionKey === descriptor.connectionKey;
  }
  return (
    connectionKey === descriptor.connectionKey ||
    connectionKey.startsWith(`${descriptor.connectionKey}-`)
  );
}

function buildGithub(input: GithubInput): BuiltOAuthApp {
  return {
    provider: {
      id: "github",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      scopes: DEFAULT_GITHUB_SCOPES,
      tokenEndpointAcceptJson: true,
    },
    flow: {
      connectionKey: "github",
      hostPattern: "api.github.com",
      displayName: "GitHub",
      envMappings: [GH_TOKEN_ENV_MAPPING],
    },
    connectionDisplayName: "GitHub",
  };
}

function buildGhe(input: GheInput): BuiltOAuthApp {
  const host = input.host;
  return {
    provider: {
      id: "github-enterprise",
      authorizationUrl: `https://${host}/login/oauth/authorize`,
      tokenEndpoint: `https://${host}/login/oauth/access_token`,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      scopes: DEFAULT_GITHUB_SCOPES,
      tokenEndpointAcceptJson: true,
    },
    flow: {
      // Single GHE per user for now — connecting a different GHE host
      // replaces the previous one. Multi-host GHE (key on host hash) is a
      // follow-up.
      connectionKey: "github-enterprise",
      hostPattern: host,
      displayName: `GitHub Enterprise (${host})`,
      // GH_HOST is a literal config value (the user's enterprise host), not a
      // sentinel — `gh` CLI uses it to direct API calls to the right server.
      envMappings: [
        GH_TOKEN_ENV_MAPPING,
        { envName: "GH_HOST", placeholder: host },
      ],
    },
    connectionDisplayName: `GitHub Enterprise (${host})`,
  };
}

function genericConnectionKey(hostPattern: string): string {
  // Connection key derived from hostPattern so reconnecting the same host
  // updates the existing K8s Secret in place. Different hosts → different
  // keys → independent connections.
  const hash = crypto.createHash("sha1").update(hostPattern).digest("hex").slice(0, 16);
  return `generic-${hash}`;
}

function buildGeneric(input: GenericInput): BuiltOAuthApp {
  const scopes = input.scopes
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    provider: {
      id: "generic",
      authorizationUrl: input.authorizationUrl,
      tokenEndpoint: input.tokenEndpoint,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      ...(scopes.length > 0 ? { scopes } : {}),
      // `Accept: application/json` is a safe default — providers that don't
      // honor it return JSON anyway, and the few that fall back to
      // form-encoded are caught by the engine's lenient parser.
      tokenEndpointAcceptJson: true,
    },
    flow: {
      connectionKey: genericConnectionKey(input.hostPattern),
      hostPattern: input.hostPattern,
      displayName: input.displayName,
    },
    connectionDisplayName: input.displayName,
  };
}

/**
 * Returns a copy of the descriptor with inputs covered by `defaultsForApp`
 * pruned. Fields the admin pre-set never appear in the form; the user only
 * sees what they still need to supply.
 */
function pruneDescriptorInputs(
  descriptor: OAuthAppDescriptor,
  defaultsForApp: Record<string, string | undefined>,
): OAuthAppDescriptor {
  const filtered = descriptor.inputs.filter(
    (input) => !defaultsForApp[input.name],
  );
  if (filtered.length === descriptor.inputs.length) return descriptor;
  return { ...descriptor, inputs: filtered };
}

function defaultsObject(
  descriptor: OAuthAppDescriptor,
  defaults: OAuthAppDefaults,
): Record<string, string | undefined> {
  if (descriptor.id === "github") {
    return {
      clientId: defaults.github?.clientId,
      clientSecret: defaults.github?.clientSecret,
    };
  }
  if (descriptor.id === "github-enterprise") {
    return {
      host: defaults.githubEnterprise?.host,
      clientId: defaults.githubEnterprise?.clientId,
      clientSecret: defaults.githubEnterprise?.clientSecret,
    };
  }
  return {};
}

export function createOAuthAppRegistry(
  defaults: OAuthAppDefaults = {},
): OAuthAppRegistry {
  const decorated: OAuthAppDescriptor[] = Object.values(DESCRIPTORS).map((d) =>
    pruneDescriptorInputs(d, defaultsObject(d, defaults)),
  );
  const byId = new Map(decorated.map((d) => [d.id, d]));

  /**
   * Merge admin defaults with user-supplied input before validation.
   * User input wins when both are present so a user can still override
   * a default if the descriptor still surfaces the field.
   */
  function withDefaults(id: OAuthAppId, rawInput: unknown): unknown {
    const base = defaultsObject(DESCRIPTORS[id], defaults);
    const user = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(base)) if (v != null) merged[k] = v;
    for (const [k, v] of Object.entries(user)) if (v !== undefined) merged[k] = v;
    return merged;
  }

  return {
    list: () => decorated,
    get: (id: string) => byId.get(id as OAuthAppId) ?? null,
    build: (id, rawInput) => {
      const merged = withDefaults(id, rawInput);
      if (id === "github") return buildGithub(githubInputSchema.parse(merged));
      if (id === "github-enterprise") return buildGhe(gheInputSchema.parse(merged));
      if (id === "generic") return buildGeneric(genericInputSchema.parse(merged));
      throw new Error(`unknown app id: ${id as string}`);
    },
  };
}
