import type {
  ConnectionTemplate,
  HeaderConnectionTemplate,
  NoneConnectionTemplate,
  OAuthConnectionTemplate,
} from "./connection-template.js";

/**
 * Connection Template catalog (ADR-051). Each entry is *data* — one
 * auth-kind per template, declarative defaults + contributions. Adding
 * a new app or provider is one block here.
 *
 * Operator-supplied OAuth credentials (clientId / clientSecret) are
 * injected at compose time; static templates without configured creds
 * are filtered out of the public catalog so the UI doesn't surface
 * "Connect to X" buttons for integrations the deployment can't actually
 * fulfill.
 */

// ─── Operator-supplied OAuth credentials ─────────────────────────────────

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
  /** GitHub-only: when the configured client is a GitHub App, the slug
   *  drives the post-authorize "Install on GitHub" prompt. */
  appSlug?: string;
}

export interface GitHubEnterpriseCredentials {
  /** GHE host (e.g. `ghe.example.com`). Required when the operator
   *  has pre-configured a GHE client; absence means GHE is in the
   *  catalog but the user supplies host + clientId + clientSecret. */
  host?: string;
  clientId?: string;
  clientSecret?: string;
  appSlug?: string;
}

export interface OperatorCredentials {
  /** github.com OAuth or GitHub App. */
  github?: OAuthClientCredentials;
  /** GitHub Enterprise. Host + creds are independently optional — the
   *  template surfaces in the catalog regardless and the UI form fills
   *  in whatever inputs the operator left blank. */
  githubEnterprise?: GitHubEnterpriseCredentials;
  /** Shared client for every Google service template (one Cloud project
   *  hosting one OAuth client serves all the Workspace integrations,
   *  mirroring the old `credentialFamily: "google"` mechanism). */
  google?: OAuthClientCredentials;
  /** Spotify dashboard OAuth client. */
  spotify?: OAuthClientCredentials;
}

// ─── Header-kind templates (provider presets) ────────────────────────────

const ANTHROPIC: HeaderConnectionTemplate = {
  id: "anthropic",
  name: "Anthropic",
  category: "app",
  isCustom: false,
  description: "Anthropic API access (Claude). Sent as `x-api-key`.",
  iconSlug: "anthropic",
  authKind: "header",
  host: "api.anthropic.com",
  headerName: "x-api-key",
  valueFormat: "{value}",
  contributions: [
    {
      kind: "env",
      name: "ANTHROPIC_API_KEY",
      placeholder: "dummy-placeholder",
    },
    { kind: "egress-host", host: "api.anthropic.com" },
  ],
};

const OPENAI: HeaderConnectionTemplate = {
  id: "openai",
  name: "OpenAI",
  category: "app",
  isCustom: false,
  description: "OpenAI API access. Scoped to /v1/*.",
  iconSlug: "openai",
  authKind: "header",
  host: "api.openai.com",
  headerName: "Authorization",
  valueFormat: "Bearer {value}",
  contributions: [
    { kind: "env", name: "OPENAI_API_KEY", placeholder: "dummy-placeholder" },
    {
      kind: "egress-host",
      host: "api.openai.com",
      pathPattern: "/v1/*",
    },
  ],
};

/** IBM LiteLLM ETE proxy. Carries the standard Claude Code model-pin
 *  envs at the configured defaults; per-connection pin overrides are a
 *  follow-up. */
const IBM_LITELLM: HeaderConnectionTemplate = {
  id: "ibm-litellm",
  name: "IBM LiteLLM ETE Proxy",
  category: "app",
  isCustom: false,
  description:
    "Proxy that fronts model endpoints for IBM-internal Claude Code.",
  iconSlug: "ibm",
  authKind: "header",
  host: "ete-litellm.bx.cloud9.ibm.com",
  headerName: "Authorization",
  valueFormat: "Bearer {value}",
  contributions: [
    {
      kind: "env",
      name: "ANTHROPIC_BASE_URL",
      placeholder: "https://ete-litellm.bx.cloud9.ibm.com",
    },
    {
      kind: "env",
      name: "ANTHROPIC_AUTH_TOKEN",
      placeholder: "dummy-placeholder",
    },
    {
      kind: "env",
      name: "ANTHROPIC_DEFAULT_OPUS_MODEL",
      placeholder: "claude-opus-4-7",
    },
    {
      kind: "env",
      name: "ANTHROPIC_DEFAULT_SONNET_MODEL",
      placeholder: "claude-sonnet-4-6",
    },
    {
      kind: "env",
      name: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      placeholder: "claude-haiku-4-5",
    },
    { kind: "env", name: "OPENAI_MODEL", placeholder: "gpt-5.5" },
    { kind: "egress-host", host: "ete-litellm.bx.cloud9.ibm.com" },
  ],
};

/** Bob shell. Token goes in via `Apikey` (Bearer triggers JWT auth). */
const BOB: HeaderConnectionTemplate = {
  id: "bob",
  name: "Bob Shell",
  category: "app",
  isCustom: false,
  description: "Bob CLI model proxy.",
  iconSlug: "bob",
  authKind: "header",
  host: "api.us-east.bob.ibm.com",
  headerName: "Authorization",
  valueFormat: "Apikey {value}",
  contributions: [
    {
      kind: "env",
      name: "BOB_BASE_URL",
      placeholder: "https://api.us-east.bob.ibm.com",
    },
    { kind: "env", name: "BOB_API_KEY", placeholder: "dummy-placeholder" },
    { kind: "egress-host", host: "api.us-east.bob.ibm.com" },
  ],
};

// ─── Static OAuth templates ───────────────────────────────────────────────

function github(creds?: OAuthClientCredentials): OAuthConnectionTemplate {
  return {
    id: "github",
    name: "GitHub",
    category: "app",
    isCustom: false,
    description: "Read + write GitHub repos, issues, PRs.",
    iconSlug: "github",
    authKind: "oauth",
    // Operator-supplied defaults if configured; otherwise the user is
    // asked for clientId + clientSecret at create time.
    ...(creds?.clientId ? { clientId: creds.clientId } : {}),
    ...(creds?.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    // GitHub App slug surfaces as opaque `extras.appSlug` — the UI keys
    // on it to show an "Install on GitHub" affordance post-authorize
    // when the configured OAuth client is a GitHub App rather than an
    // OAuth App. Off the typed schema by design.
    ...(creds?.appSlug ? { extras: { appSlug: creds.appSlug } } : {}),
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user", "user:email"],
    tokenEndpointAcceptJson: true,
    contributions: [
      { kind: "env", name: "GH_TOKEN", placeholder: "dummy-placeholder" },
      // api.github.com + raw.githubusercontent.com take the default
      // `Authorization: Bearer {value}` — `injection: {}` opts them into
      // the per-host SDS chain so Envoy rewrites the Authorization header
      // on the wire. Without this they fall to the default passthrough
      // chain and the agent's placeholder Authorization reaches GitHub
      // verbatim.
      { kind: "egress-host", host: "api.github.com", injection: {} },
      // git+HTTPS to github.com uses HTTP Basic with `x-access-token:`,
      // not the api.github.com Bearer form. Per-host injection override
      // makes the same OAuth token work for both rails (issue #219).
      {
        kind: "egress-host",
        host: "github.com",
        injection: {
          headerName: "Authorization",
          valueFormat: "Basic {value}",
          encoding: "basic-x-access-token",
        },
      },
      {
        kind: "egress-host",
        host: "raw.githubusercontent.com",
        injection: {},
      },
    ],
  };
}

/**
 * GitHub Enterprise — host-parametrized. Host comes from the operator
 * (config.defaultGithubEnterpriseHost) when configured; otherwise the
 * user supplies it at create time. Authorization / token URLs carry
 * `{host}` placeholders that `buildOAuthStatic` substitutes; the same
 * substitution drives the host-dependent contributions.
 */
function githubEnterprise(
  creds?: GitHubEnterpriseCredentials,
): OAuthConnectionTemplate {
  return {
    id: "github-enterprise",
    name: "GitHub Enterprise",
    category: "app",
    isCustom: false,
    description:
      "Connect a GitHub Enterprise host so agents can call its API on your behalf.",
    iconSlug: "github",
    authKind: "oauth",
    // Operator preset (when set) drops `host` from `requiredInputs` so
    // the UI form pre-fills it. URLs always carry the `{host}`
    // placeholder — `buildOAuthStatic` resolves with input.host ??
    // template.host so a user-supplied override wins consistently.
    ...(creds?.host ? { host: creds.host } : {}),
    ...(creds?.clientId ? { clientId: creds.clientId } : {}),
    ...(creds?.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    ...(creds?.appSlug ? { extras: { appSlug: creds.appSlug } } : {}),
    authorizationUrl: "https://{host}/login/oauth/authorize",
    tokenUrl: "https://{host}/login/oauth/access_token",
    scopes: ["repo", "read:user", "user:email"],
    tokenEndpointAcceptJson: true,
    // Static contributions intentionally empty — the host-dependent
    // ones (GH_HOST env, api.<host> + <host> egress) are emitted at
    // build time from the resolved host. Keeping them dynamic avoids
    // a template variant per possible host.
    contributions: [
      { kind: "env", name: "GH_TOKEN", placeholder: "dummy-placeholder" },
    ],
  };
}

function spotify(creds?: OAuthClientCredentials): OAuthConnectionTemplate {
  return {
    id: "spotify",
    name: "Spotify",
    category: "app",
    isCustom: false,
    description: "Read library + control playback on your behalf.",
    iconSlug: "spotify",
    authKind: "oauth",
    ...(creds?.clientId ? { clientId: creds.clientId } : {}),
    ...(creds?.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    authorizationUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    // Spotify exposes per-feature scopes; this is a reasonable read+
    // playback default. The catalog can carve narrower templates later.
    scopes: [
      "user-read-email",
      "user-read-private",
      "user-library-read",
      "user-modify-playback-state",
      "user-read-playback-state",
    ],
    contributions: [{ kind: "egress-host", host: "api.spotify.com" }],
  };
}

// ─── Google services (one Cloud project, many service templates) ─────────

interface GoogleServiceDef {
  id: string;
  name: string;
  description: string;
  scopes: string[];
  hosts: { host: string; pathPattern?: string }[];
}

const GOOGLE_BASELINE_SCOPES = ["openid", "email", "profile"];

const GOOGLE_SERVICES: GoogleServiceDef[] = [
  {
    id: "google-gmail",
    name: "Gmail",
    description: "Read, compose, and send emails via Gmail.",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    hosts: [
      { host: "gmail.googleapis.com" },
      { host: "www.googleapis.com", pathPattern: "/gmail/*" },
    ],
  },
  {
    id: "google-admin",
    name: "Google Admin",
    description: "Manage users, groups, and devices in Workspace.",
    scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
    hosts: [{ host: "admin.googleapis.com" }],
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "Access report data and run analytics queries.",
    scopes: ["https://www.googleapis.com/auth/analytics"],
    hosts: [{ host: "analyticsdata.googleapis.com" }],
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Read, create, and manage calendar events.",
    scopes: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    hosts: [{ host: "www.googleapis.com", pathPattern: "/calendar/*" }],
  },
  {
    id: "google-classroom",
    name: "Google Classroom",
    description: "Manage classes, rosters, and invitations.",
    scopes: ["https://www.googleapis.com/auth/classroom.courses"],
    hosts: [{ host: "classroom.googleapis.com" }],
  },
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Read, create, and edit Google Docs documents.",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    hosts: [{ host: "docs.googleapis.com" }],
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Read, create, and manage files and folders.",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    hosts: [
      { host: "www.googleapis.com", pathPattern: "/drive/*" },
      { host: "www.googleapis.com", pathPattern: "/upload/drive/*" },
    ],
  },
  {
    id: "google-forms",
    name: "Google Forms",
    description: "Read, create, and edit forms and responses.",
    scopes: ["https://www.googleapis.com/auth/forms.body"],
    hosts: [{ host: "forms.googleapis.com" }],
  },
  {
    id: "google-meet",
    name: "Google Meet",
    description: "Create and manage meetings.",
    scopes: ["https://www.googleapis.com/auth/meetings.space.created"],
    hosts: [{ host: "meet.googleapis.com" }],
  },
  {
    id: "google-photos",
    name: "Google Photos",
    description: "Manage photos, videos, and albums.",
    scopes: ["https://www.googleapis.com/auth/photoslibrary"],
    hosts: [{ host: "photoslibrary.googleapis.com" }],
  },
  {
    id: "google-search-console",
    name: "Google Search Console",
    description: "View search traffic and manage site presence.",
    scopes: ["https://www.googleapis.com/auth/webmasters"],
    hosts: [{ host: "searchconsole.googleapis.com" }],
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read, create, and edit spreadsheets.",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    hosts: [{ host: "sheets.googleapis.com" }],
  },
  {
    id: "google-slides",
    name: "Google Slides",
    description: "Read, create, and edit presentations.",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    hosts: [{ host: "slides.googleapis.com" }],
  },
  {
    id: "google-tasks",
    name: "Google Tasks",
    description: "Manage task lists and tasks.",
    scopes: ["https://www.googleapis.com/auth/tasks"],
    hosts: [{ host: "tasks.googleapis.com" }],
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Manage playlists, videos, and channel content.",
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube",
      "https://www.googleapis.com/auth/youtube.force-ssl",
    ],
    hosts: [
      { host: "youtube.googleapis.com" },
      { host: "www.googleapis.com", pathPattern: "/youtube/*" },
    ],
  },
];

function googleService(
  def: GoogleServiceDef,
  creds?: OAuthClientCredentials,
): OAuthConnectionTemplate {
  return {
    id: def.id,
    name: def.name,
    category: "app",
    isCustom: false,
    description: def.description,
    iconSlug: def.id,
    authKind: "oauth",
    ...(creds?.clientId ? { clientId: creds.clientId } : {}),
    ...(creds?.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [...GOOGLE_BASELINE_SCOPES, ...def.scopes],
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    contributions: def.hosts.map((h) => ({
      kind: "egress-host",
      host: h.host,
      ...(h.pathPattern ? { pathPattern: h.pathPattern } : {}),
    })),
  };
}

// ─── Custom templates ─────────────────────────────────────────────────────

/** User supplies every field — host / headerName / valueFormat / value.
 *  No template presets. */
const CUSTOM_HEADER: HeaderConnectionTemplate = {
  id: "custom-header",
  name: "Custom header credential",
  category: "other",
  isCustom: true,
  description:
    "Inject a header (API key, PAT, bearer) on outbound calls to a host.",
  iconSlug: "key",
  authKind: "header",
  contributions: [],
};

/** User supplies every OAuth field — for Authorization-Code OAuth
 *  providers we don't ship a preset for. */
const CUSTOM_OAUTH: OAuthConnectionTemplate = {
  id: "custom-oauth",
  name: "Custom OAuth provider",
  category: "other",
  isCustom: true,
  description:
    "Connect any OAuth 2.1 authorization-code provider. Supply the URLs and your client credentials.",
  iconSlug: "key",
  authKind: "oauth",
  contributions: [],
};

/** Custom MCP server — OAuth via DCR. User supplies a URL; the build
 *  step runs `.well-known` discovery + RFC 7591 dynamic client
 *  registration. */
const CUSTOM_MCP_OAUTH: OAuthConnectionTemplate = {
  id: "custom-mcp-oauth",
  name: "Custom MCP server (OAuth)",
  category: "mcp",
  isCustom: true,
  description:
    "MCP server that authenticates with OAuth — discovery + DCR run at create time.",
  iconSlug: "mcp",
  authKind: "oauth",
  dynamicRegistration: true,
  contributions: [],
};

/** Custom MCP server — no auth. User supplies a URL. */
const CUSTOM_MCP_NONE: NoneConnectionTemplate = {
  id: "custom-mcp-none",
  name: "Custom MCP server (no auth)",
  category: "mcp",
  isCustom: true,
  description: "Add an MCP server by URL with no authentication.",
  iconSlug: "mcp",
  authKind: "none",
  contributions: [],
};

/** Custom MCP server — Custom Header injection. User pastes the MCP
 *  JSON config block + supplies a header injection config (host +
 *  headerName + valueFormat + value), same as Custom Header. The
 *  Connection emits an mcp-entry Contribution carrying the verbatim
 *  user-pasted JSON alongside the header-auth pieces. */
const CUSTOM_MCP_CUSTOM: HeaderConnectionTemplate = {
  id: "custom-mcp-custom",
  name: "Custom MCP server (custom)",
  category: "mcp",
  isCustom: true,
  description:
    "MCP server with a user-pasted JSON config and a custom header credential injected on outbound calls.",
  iconSlug: "mcp",
  authKind: "header",
  contributions: [],
};

// ─── Catalog assembly ─────────────────────────────────────────────────────

/**
 * Build the catalog. Static OAuth templates (GitHub, Spotify, Google
 * services) are ALWAYS in the catalog; operator config only supplies
 * defaults. When defaults are absent the UI form prompts the user for
 * clientId + clientSecret at create time.
 */
export function buildCatalog(
  creds: OperatorCredentials = {},
): ConnectionTemplate[] {
  return [
    // Provider presets (header).
    ANTHROPIC,
    OPENAI,
    IBM_LITELLM,
    BOB,
    // Static OAuth — operator config fills in defaults when present.
    github(creds.github),
    githubEnterprise(creds.githubEnterprise),
    spotify(creds.spotify),
    ...GOOGLE_SERVICES.map((def) => googleService(def, creds.google)),
    // Custom — always present.
    CUSTOM_OAUTH,
    CUSTOM_HEADER,
    CUSTOM_MCP_OAUTH,
    CUSTOM_MCP_NONE,
    CUSTOM_MCP_CUSTOM,
  ];
}
