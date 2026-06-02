import type {
  ConnectionTemplate,
  HeaderConnectionTemplate,
  NoneConnectionTemplate,
  OAuthConnectionTemplate,
} from "./connection-template.js";

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
}

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
    { kind: "egress-allow", host: "api.anthropic.com" },
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
      kind: "egress-allow",
      host: "api.openai.com",
      pathPattern: "/v1/*",
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
    { kind: "egress-allow", host: "ete-litellm.bx.cloud9.ibm.com" },
  ],
};

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
    { kind: "egress-allow", host: "api.us-east.bob.ibm.com" },
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
    iconSlug: "github",
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
      "user-read-email",
      "user-read-private",
      "user-library-read",
      "user-modify-playback-state",
      "user-read-playback-state",
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
    contributions: def.hosts.map((h) => ({
      kind: "egress-inject",
      host: h.host,
      ...(h.pathPattern ? { pathPattern: h.pathPattern } : {}),
      headerName: "Authorization",
      valueFormat: "Bearer {value}",
    })),
  };
}

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
    OPENAI,
    IBM_LITELLM,
    BOB,
    github(creds.github),
    githubEnterprise(creds.githubEnterprise),
    spotify(creds.spotify),
    ...GOOGLE_SERVICES.map((def) => googleService(def, creds.google)),
    CUSTOM_HEADER,
    CUSTOM_MCP_OAUTH,
    CUSTOM_MCP_NONE,
  ];
}
