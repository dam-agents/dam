import {
  type Contribution,
  type EnvMapping,
  ibmLitellmEnvMappings,
  bobEnvMappings,
  BOB_CHAT_MODES,
  IBM_LITELLM_HOST,
  BOB_HOST,
} from "api-server-api";
import type {
  ConnectionTemplate,
  HeaderConnectionTemplate,
  NoneConnectionTemplate,
  OAuthConnectionTemplate,
} from "./connection-template.js";

// Project a provider preset's env bundle into `env` contributions
function envContributions(mappings: EnvMapping[]): Contribution[] {
  return mappings.map((m) => ({
    kind: "env" as const,
    name: m.envName,
    placeholder: m.placeholder,
  }));
}

export interface OAuthClientCredentials {
  clientId: string;
  clientSecret: string;
  appSlug?: string;
}

export interface GitHubEnterpriseCredentials {
  host?: string;
  clientId?: string;
  clientSecret?: string;
  appSlug?: string;
}

export interface OperatorCredentials {
  github?: OAuthClientCredentials;
  githubEnterprise?: GitHubEnterpriseCredentials;
  google?: OAuthClientCredentials;
  spotify?: OAuthClientCredentials;
  slack?: OAuthClientCredentials;
}

const ANTHROPIC: HeaderConnectionTemplate = {
  id: "anthropic",
  name: "Anthropic (API Key)",
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
    {
      kind: "egress-inject",
      host: "api.anthropic.com",
      headerName: "x-api-key",
      valueFormat: "{value}",
    },
  ],
};

const ANTHROPIC_OAUTH: HeaderConnectionTemplate = {
  id: "anthropic-oauth",
  name: "Anthropic (OAuth Token)",
  category: "app",
  isCustom: false,
  description:
    "Anthropic API access (Claude) via an OAuth token. Sent as `Authorization: Bearer`.",
  iconSlug: "anthropic",
  authKind: "header",
  host: "api.anthropic.com",
  headerName: "Authorization",
  valueFormat: "Bearer {value}",
  contributions: [
    {
      kind: "env",
      name: "CLAUDE_CODE_OAUTH_TOKEN",
      placeholder: "dummy-placeholder",
    },
    {
      kind: "egress-inject",
      host: "api.anthropic.com",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
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
      kind: "egress-inject",
      host: "api.openai.com",
      pathPattern: "/v1/*",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
  ],
};

const IBM_LITELLM: HeaderConnectionTemplate = {
  id: "ibm-litellm",
  name: "IBM LiteLLM ETE Proxy",
  category: "app",
  isCustom: false,
  description:
    "Proxy that fronts model endpoints for IBM-internal Claude Code.",
  iconSlug: "ibm",
  authKind: "header",
  host: IBM_LITELLM_HOST,
  headerName: "Authorization",
  valueFormat: "Bearer {value}",
  // Env bundle + host sourced from the provider preset so they can't drift; Claude model pins are omitted as the agent's gateway discovers them.
  contributions: [
    ...envContributions(ibmLitellmEnvMappings()),
    {
      kind: "egress-inject",
      host: IBM_LITELLM_HOST,
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
  ],
};

// Transport header for Bob's `?key=` injection; distinct from `Authorization` so both injections coexist on one host without colliding.
const BOB_QUERY_PARAM_HEADER = "X-Bobshell-Internal";

const BOB: HeaderConnectionTemplate = {
  id: "bob",
  name: "Bob Shell",
  category: "app",
  isCustom: false,
  description: "Bob CLI model proxy.",
  iconSlug: "bob",
  authKind: "header",
  host: BOB_HOST,
  headerName: "Authorization",
  // Opaque api-keys go in under `Apikey`; `Bearer` triggers JWT auth.
  valueFormat: "Apikey {value}",
  // Dual injection: `Apikey` header on every request plus the `?key=` URL param Bob appends to admin endpoints.
  contributions: [
    ...envContributions(bobEnvMappings()),
    {
      kind: "egress-inject",
      host: BOB_HOST,
      headerName: "Authorization",
      valueFormat: "Apikey {value}",
    },
    {
      kind: "egress-inject",
      host: BOB_HOST,
      headerName: BOB_QUERY_PARAM_HEADER,
      valueFormat: "{value}",
      queryParamName: "key",
    },
  ],
  configInputs: [
    {
      inputName: "model",
      envName: "BOB_SHELL_MODEL",
      label: "Model",
      hint: "Default model for new sessions. Empty → Bob's built-in default.",
    },
    {
      inputName: "instanceId",
      envName: "BOB_INSTANCE_ID",
      label: "Instance ID",
      hint: "Sets the x-instance-id header (IBM tenant scoping).",
    },
    {
      inputName: "teamId",
      envName: "BOB_TEAM_ID",
      label: "Team ID",
      hint: "Sets the x-team-id header.",
    },
    {
      inputName: "maxCoins",
      envName: "BOB_MAX_COINS",
      label: "Max coins",
      hint: "Budget cap; Bob exits when exceeded.",
      pattern: "^[1-9]\\d*$",
      patternHint: "a positive integer",
    },
    {
      inputName: "chatMode",
      envName: "BOB_CHAT_MODE",
      label: "Chat mode",
      hint: `Default chat persona. One of: ${BOB_CHAT_MODES.join(", ")}.`,
      enumValues: BOB_CHAT_MODES,
    },
  ],
};

const MODAL_HOST = "api.modal.com";

// Modal's gRPC auth is two metadata headers: x-modal-token-id (a public id) and
// x-modal-token-secret (the secret). Only the secret is the connection
// credential, injected at the gateway over an HTTP/2 chain. The token-id is
// non-secret and rides as a plain env (filled via the Token ID config input).
// Blob uploads hit storage.googleapis.com (+ Cloudflare R2 with dynamic hosts,
// approved from the HITL inbox at first run).
const MODAL: HeaderConnectionTemplate = {
  id: "modal",
  name: "Modal",
  category: "app",
  isCustom: false,
  description:
    "Modal cloud GPUs for kernel-evaluation workloads (e.g. K-Search).",
  iconSlug: "modal",
  authKind: "header",
  host: MODAL_HOST,
  headerName: "x-modal-token-secret",
  valueFormat: "{value}",
  contributions: [
    // Placeholder so the modal client emits the header; the gateway overwrites
    // it with the real secret. Keeps the `as-` shape the client expects.
    {
      kind: "env",
      name: "MODAL_TOKEN_SECRET",
      placeholder: "as-dummy-placeholder",
    },
    {
      kind: "egress-inject",
      host: MODAL_HOST,
      headerName: "x-modal-token-secret",
      valueFormat: "{value}",
      http2: true,
    },
    // Modal streams function I/O and image-build context through cloud blob
    // storage (it picks a backend with fallback) — allow the ones observed.
    { kind: "egress-allow", host: "storage.googleapis.com" },
    { kind: "egress-allow", host: "s3.amazonaws.com" },
  ],
  configInputs: [
    {
      inputName: "tokenId",
      envName: "MODAL_TOKEN_ID",
      label: "Token ID",
      hint: "Modal token id (ak-…). Required, non-secret — sent as x-modal-token-id.",
    },
  ],
};

function github(creds?: OAuthClientCredentials): OAuthConnectionTemplate {
  return {
    id: "github",
    name: "GitHub",
    category: "app",
    isCustom: false,
    description: "Read + write GitHub repos, issues, PRs.",
    iconSlug: "github",
    authKind: "oauth",
    setupUrl: "https://github.com/settings/developers",
    ...(creds?.clientId ? { clientId: creds.clientId } : {}),
    ...(creds?.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    ...(creds?.appSlug ? { extras: { appSlug: creds.appSlug } } : {}),
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user", "user:email"],
    tokenEndpointAcceptJson: true,
    contributions: [
      { kind: "env", name: "GH_TOKEN", placeholder: "dummy-placeholder" },
      {
        kind: "egress-inject",
        host: "api.github.com",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
      {
        kind: "egress-inject",
        host: "github.com",
        headerName: "Authorization",
        valueFormat: "Basic {value}",
        encoding: "basic-x-access-token",
      },
      {
        kind: "egress-inject",
        host: "raw.githubusercontent.com",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
    ],
  };
}

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
    iconSlug: "github-enterprise",
    authKind: "oauth",
    ...(creds?.host ? { host: creds.host } : {}),
    ...(creds?.clientId ? { clientId: creds.clientId } : {}),
    ...(creds?.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    ...(creds?.appSlug ? { extras: { appSlug: creds.appSlug } } : {}),
    authorizationUrl: "https://{host}/login/oauth/authorize",
    tokenUrl: "https://{host}/login/oauth/access_token",
    scopes: ["repo", "read:user", "user:email"],
    tokenEndpointAcceptJson: true,
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
    setupUrl: "https://developer.spotify.com/dashboard",
    localhostCallbackAlias: "127.0.0.1",
    ...(creds?.clientId ? { clientId: creds.clientId } : {}),
    ...(creds?.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    authorizationUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    scopes: [
      "user-read-private",
      "user-read-email",
      "playlist-read-private",
      "playlist-read-collaborative",
      "playlist-modify-private",
      "playlist-modify-public",
      "user-library-read",
      "user-library-modify",
      "user-top-read",
      "user-read-recently-played",
      "user-read-playback-state",
      "user-modify-playback-state",
      "user-read-currently-playing",
    ],
    contributions: [
      {
        kind: "egress-inject",
        host: "api.spotify.com",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
    ],
  };
}

// User-token scopes advertised by Slack's MCP server
// (https://mcp.slack.com/.well-known/oauth-authorization-server). Requesting
// the full set lets the agent use every Slack MCP tool — search, channel and
// thread history, posting, reactions, canvases, files, and user lookups.
const SLACK_SCOPES = [
  "search:read.public",
  "search:read.private",
  "search:read.mpim",
  "search:read.im",
  "search:read.files",
  "search:read.users",
  "channels:history",
  "groups:history",
  "mpim:history",
  "im:history",
  "channels:read",
  "groups:read",
  "mpim:read",
  "channels:write",
  "groups:write",
  "im:write",
  "mpim:write",
  "chat:write",
  "reactions:read",
  "reactions:write",
  "canvases:read",
  "canvases:write",
  "files:read",
  "emoji:read",
  "users:read",
  "users:read.email",
];

function slack(creds?: OAuthClientCredentials): OAuthConnectionTemplate {
  return {
    id: "slack",
    name: "Slack",
    category: "app",
    isCustom: false,
    description:
      "Search, read, and post in Slack on your behalf — backed by Slack's MCP server.",
    iconSlug: "slack",
    authKind: "oauth",
    setupUrl: "https://api.slack.com/apps",
    ...(creds?.clientId ? { clientId: creds.clientId } : {}),
    ...(creds?.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    // Slack's MCP OAuth is a standards-compliant AS (PKCE/S256, confidential
    // client via client_secret_post) but offers no dynamic client registration,
    // so the app is registered out of band and connects through the static
    // OAuth path with these fixed endpoints.
    authorizationUrl: "https://slack.com/oauth/v2_user/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.user.access",
    scopes: SLACK_SCOPES,
    contributions: [
      // The agent reaches Slack through its hosted MCP server, not a bearer in
      // the pod: the mcp-entry writes a placeholder Authorization header into
      // the harness MCP config and Envoy swaps in the real user token on egress
      // to mcp.slack.com (same swap the OAuth-DCR MCP path relies on).
      {
        kind: "egress-inject",
        host: "mcp.slack.com",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
      {
        kind: "mcp-entry",
        name: "slack",
        url: "https://mcp.slack.com/mcp",
        headers: { Authorization: "Bearer dummy-placeholder" },
      },
    ],
  };
}

interface GoogleServiceDef {
  id: string;
  name: string;
  description: string;
  scopes: string[];
  hosts: { host: string; pathPattern?: string }[];
  iconSlug?: string;
}

const GOOGLE_BASELINE_SCOPES = ["openid", "email", "profile"];

const GOOGLE_SERVICES: GoogleServiceDef[] = [
  {
    id: "google-gmail",
    name: "Gmail",
    iconSlug: "gmail",
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
    id: "google-health",
    name: "Google Health",
    description:
      "Access activity, sleep, and health metrics from Fitbit and connected devices.",
    scopes: [
      "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
      "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
      "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    ],
    hosts: [{ host: "health.googleapis.com" }],
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
    iconSlug: def.iconSlug ?? def.id,
    authKind: "oauth",
    credentialFamily: "google",
    setupUrl: "https://console.cloud.google.com/apis/credentials",
    ...(creds?.clientId ? { clientId: creds.clientId } : {}),
    ...(creds?.clientSecret ? { clientSecret: creds.clientSecret } : {}),
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [...GOOGLE_BASELINE_SCOPES, ...def.scopes],
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    contributions: [
      // The Google Workspace CLI (`gws`, baked into platform-base) reads this
      // env var as its OAuth access token. Granting any Google connection
      // stamps the sentinel here; the egress-inject contribution below then
      // has Envoy swap it for the real Bearer token on *.googleapis.com calls.
      // Same name across all Google services — first-granted-wins.
      {
        kind: "env",
        name: "GOOGLE_WORKSPACE_CLI_TOKEN",
        placeholder: "dummy-placeholder",
      },
      ...def.hosts.map((h) => ({
        kind: "egress-inject" as const,
        host: h.host,
        ...(h.pathPattern ? { pathPattern: h.pathPattern } : {}),
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      })),
      // Google clients fetch the public discovery doc at startup (e.g.
      // /discovery/v1/apis/gmail/v1/rest), outside each service's host scope.
      // Public + read-only, so allow without credential injection.
      {
        kind: "egress-allow" as const,
        host: "www.googleapis.com",
        pathPattern: "/discovery/v1/apis/*",
      },
    ],
  };
}

// github.com uses HTTP Basic `x-access-token:<pat>` (GitHub's git-over-HTTPS PAT form); api.github.com and raw.githubusercontent.com use Bearer.
const GITHUB_PAT: HeaderConnectionTemplate = {
  id: "github-pat",
  name: "GitHub (Personal Access Token)",
  category: "app",
  isCustom: false,
  description:
    "Read + write GitHub repos, issues, PRs with a personal access token.",
  iconSlug: "github",
  authKind: "header",
  host: "api.github.com",
  headerName: "Authorization",
  valueFormat: "Bearer {value}",
  contributions: [
    { kind: "env", name: "GH_TOKEN", placeholder: "dummy-placeholder" },
    {
      kind: "egress-inject",
      host: "api.github.com",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
    {
      kind: "egress-inject",
      host: "github.com",
      headerName: "Authorization",
      valueFormat: "Basic {value}",
      encoding: "basic-x-access-token",
    },
    {
      kind: "egress-inject",
      host: "raw.githubusercontent.com",
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    },
  ],
};

const CUSTOM_HEADER: HeaderConnectionTemplate = {
  id: "custom-header",
  name: "Custom header credential",
  category: "other",
  isCustom: true,
  description:
    "Inject a header (API key, PAT, bearer) on outbound calls to a host.",
  iconSlug: "key",
  authKind: "header",
  headerName: "Authorization",
  valueFormat: "Bearer {value}",
  contributions: [],
};

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

export function buildCatalog(
  creds: OperatorCredentials = {},
): ConnectionTemplate[] {
  return [
    ANTHROPIC,
    ANTHROPIC_OAUTH,
    OPENAI,
    IBM_LITELLM,
    BOB,
    MODAL,
    github(creds.github),
    GITHUB_PAT,
    githubEnterprise(creds.githubEnterprise),
    spotify(creds.spotify),
    slack(creds.slack),
    ...GOOGLE_SERVICES.map((def) => googleService(def, creds.google)),
    CUSTOM_HEADER,
    CUSTOM_MCP_OAUTH,
    CUSTOM_MCP_NONE,
  ];
}
