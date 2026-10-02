/**
 * Connection templates mirror the api-server catalog
 * (`packages/api-server/src/modules/connections/domain/catalog.ts`) as
 * `templateToView` renders it, for an install whose operator configured
 * GitHub and Slack OAuth apps. Trusted egress hosts mirror
 * `helm/values.yaml` `trustedHosts`.
 */
import type {
  ConnectionTemplateView,
  ConnectionView,
  Contribution,
  EgressRuleView,
} from "api-server-api";

type TemplateInput = ConnectionTemplateView["inputs"][number];

import { at } from "../platform";
import { ago, IDS, whenPopulated } from "../scenario";
import { NotFound } from "../trpc-server";
import { AGENTS } from "./agents";

const UI_BASE_URL = "https://agents.example.com";
const CALLBACK_URL = `${UI_BASE_URL}/api/oauth/callback`;
const GITHUB_CLIENT_ID = "Iv23liQx7Rk2mZp9aT4c";
const SLACK_CLIENT_ID = "4718293056.7730291845621";

const PLACEHOLDER = "dummy-placeholder";

type Family = NonNullable<ConnectionTemplateView["family"]>;
const GITHUB_FAMILY: Family = { id: "github", title: "GitHub" };
const GITHUB_ENTERPRISE_FAMILY: Family = {
  id: "github-enterprise",
  title: "GitHub Enterprise",
};
const MODAL_FAMILY: Family = { id: "modal", title: "Modal" };
const KUBERNETES_FAMILY: Family = {
  id: "kubernetes",
  title: "Kubernetes / OpenShift",
};
const MCP_SERVER_FAMILY: Family = { id: "mcp-server", title: "MCP servers" };
const CUSTOM_HEADER_FAMILY: Family = {
  id: "custom-header",
  title: "Custom Headers",
};

// Inputs, as `inputsFor` in connection-template.ts builds them.
const overridable = (name: string, presetValue?: string): TemplateInput => ({
  name,
  state: "overridable",
  ...(presetValue !== undefined ? { presetValue } : {}),
});
const overridableSecret = (name: string): TemplateInput => ({
  name,
  state: "overridable",
  secret: true,
});
const required = (name: string, presetValue?: string): TemplateInput => ({
  name,
  state: "required",
  ...(presetValue !== undefined ? { presetValue } : {}),
});
const requiredSecret = (name: string): TemplateInput => ({
  name,
  state: "required",
  secret: true,
});
const optional = (name: string): TemplateInput => ({ name, state: "optional" });

/** A non-custom header template with a fixed host and header. */
function headerInputs(
  host: string,
  headerName: string,
  valueFormat: string,
): TemplateInput[] {
  return [
    overridable("host", host),
    overridable("headerName", headerName),
    overridable("valueFormat", valueFormat),
    requiredSecret("value"),
  ];
}

const GITHUB_APP_INPUTS: TemplateInput[] = [
  {
    name: "appId",
    state: "required",
    label: "App ID",
    hint: "Your GitHub App's numeric App ID (Settings → Developer settings → GitHub Apps → your app).",
  },
  {
    name: "installationId",
    state: "required",
    label: "Installation ID",
    hint: "The installation to mint tokens for — the number at the end of the installation's settings URL (…/installations/<id>).",
  },
  {
    name: "privateKey",
    state: "required",
    secret: true,
    multiline: true,
    label: "Private key (PEM)",
    hint: "A private key generated for the app (.pem). Paste the whole file including the BEGIN/END lines, or its base64 encoding.",
  },
  {
    name: "repositories",
    state: "optional",
    label: "Limit to repositories",
    hint: "Repository names, separated by spaces or commas. Leave blank for every repository the installation can reach.",
  },
  {
    name: "repositoryIds",
    state: "optional",
    label: "Limit to repository ids",
    hint: "Numeric repository ids, separated by spaces or commas. Takes precedence over names, and survives a repository rename.",
  },
  {
    name: "permissions",
    state: "optional",
    label: "Limit to permissions",
    hint: "Pairs like contents:read, issues:write. Leave blank for every permission the app was granted. You can only narrow what the installation already allows.",
  },
];

function oauthExtras(setupUrl?: string, callbackUrl = CALLBACK_URL) {
  return {
    ...(setupUrl ? { setupUrl } : {}),
    callbackUrl,
  };
}

interface GoogleDef {
  id: string;
  name: string;
  description: string;
  iconSlug?: string;
}

const GOOGLE_SERVICES: GoogleDef[] = [
  {
    id: "google-gmail",
    name: "Gmail",
    iconSlug: "gmail",
    description: "Read, compose, and send emails via Gmail.",
  },
  {
    id: "google-admin",
    name: "Google Admin",
    description: "Manage users, groups, and devices in Workspace.",
  },
  {
    id: "google-analytics",
    name: "Google Analytics",
    description: "Access report data and run analytics queries.",
  },
  {
    id: "google-calendar",
    name: "Google Calendar",
    description: "Read, create, and manage calendar events.",
  },
  {
    id: "google-classroom",
    name: "Google Classroom",
    description: "Manage classes, rosters, and invitations.",
  },
  {
    id: "google-docs",
    name: "Google Docs",
    description: "Read, create, and edit Google Docs documents.",
  },
  {
    id: "google-drive",
    name: "Google Drive",
    description: "Read, create, and manage files and folders.",
  },
  {
    id: "google-forms",
    name: "Google Forms",
    description: "Read, create, and edit forms and responses.",
  },
  {
    id: "google-health",
    name: "Google Health",
    description:
      "Access activity, sleep, and health metrics from Fitbit and connected devices.",
  },
  {
    id: "google-meet",
    name: "Google Meet",
    description: "Create and manage meetings.",
  },
  {
    id: "google-photos",
    name: "Google Photos",
    description: "Manage photos, videos, and albums.",
  },
  {
    id: "google-search-console",
    name: "Google Search Console",
    description: "View search traffic and manage site presence.",
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    description: "Read, create, and edit spreadsheets.",
  },
  {
    id: "google-slides",
    name: "Google Slides",
    description: "Read, create, and edit presentations.",
  },
  {
    id: "google-tasks",
    name: "Google Tasks",
    description: "Manage task lists and tasks.",
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Manage playlists, videos, and channel content.",
  },
];

export const TEMPLATES: ConnectionTemplateView[] = [
  {
    id: "shared-knowledge-base",
    name: "Shared knowledge base",
    category: "mcp",
    isCustom: false,
    description:
      "Read-only access to a knowledge base someone shared with you, via its share link.",
    iconSlug: "mcp",
    authKind: "header",
    inputs: [
      overridable("host", "agents.example.com"),
      required("headerName"),
      required("valueFormat"),
      requiredSecret("value"),
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic (API Key)",
    category: "app",
    isCustom: false,
    description: "Anthropic API access (Claude). Sent as `x-api-key`.",
    iconSlug: "anthropic",
    authKind: "header",
    inputs: headerInputs("api.anthropic.com", "x-api-key", "{value}"),
  },
  {
    id: "anthropic-oauth",
    name: "Anthropic (OAuth Token)",
    category: "app",
    isCustom: false,
    description:
      "Anthropic API access (Claude) via an OAuth token. Sent as `Authorization: Bearer`.",
    iconSlug: "anthropic",
    authKind: "header",
    inputs: headerInputs(
      "api.anthropic.com",
      "Authorization",
      "Bearer {value}",
    ),
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "app",
    isCustom: false,
    description: "OpenAI API access. Scoped to /v1/*.",
    iconSlug: "openai",
    authKind: "header",
    inputs: headerInputs("api.openai.com", "Authorization", "Bearer {value}"),
  },
  {
    id: "ibm-litellm",
    name: "IBM LiteLLM ETE Proxy",
    category: "app",
    isCustom: false,
    description:
      "Proxy that fronts model endpoints for IBM-internal Claude Code and Bob.",
    iconSlug: "ibm",
    authKind: "header",
    inputs: headerInputs(
      "ete-litellm.ai-models.vpc.res.ibm.com",
      "Authorization",
      "Bearer {value}",
    ),
  },
  {
    id: "bob",
    name: "Bob Shell",
    category: "app",
    isCustom: false,
    description: "Bob CLI model proxy.",
    iconSlug: "bob",
    authKind: "header",
    inputs: [
      ...headerInputs(
        "api.us-east.bob.ibm.com",
        "Authorization",
        "Apikey {value}",
      ),
      {
        name: "model",
        state: "optional",
        configInput: true,
        label: "Model",
        hint: "Default model for new sessions. Empty → Bob's built-in default.",
      },
      {
        name: "instanceId",
        state: "optional",
        configInput: true,
        label: "Instance ID",
        hint: "IBM tenant scoping. Applies to terminal (TUI) sessions; chat sessions ignore it.",
      },
      {
        name: "teamId",
        state: "optional",
        configInput: true,
        label: "Team ID",
        hint: "Team ID for general-type API keys. Applies to terminal (TUI) sessions; chat sessions ignore it.",
      },
      {
        name: "maxCost",
        state: "optional",
        configInput: true,
        label: "Max cost",
        hint: "Per-task cost cap, written to session.maxCost; Bob stops the task when exceeded.",
        pattern: "^(?:[1-9]\\d*(?:\\.\\d+)?|0?\\.\\d*[1-9]\\d*)$",
        patternHint: "a positive amount, e.g. 0.50 or 5",
      },
      {
        name: "chatMode",
        state: "optional",
        configInput: true,
        label: "Mode",
        hint: "Default mode for new sessions. One of: agent, plan, ask.",
        enumValues: ["agent", "plan", "ask"],
      },
    ],
  },
  {
    id: "modal",
    name: "Modal",
    category: "app",
    isCustom: false,
    family: MODAL_FAMILY,
    description:
      "Modal cloud GPUs for kernel-evaluation workloads (e.g. K-Search).",
    iconSlug: "modal",
    authKind: "header",
    inputs: [
      ...headerInputs("api.modal.com", "x-modal-token-secret", "{value}"),
      {
        name: "tokenId",
        state: "optional",
        configInput: true,
        label: "Token ID",
        hint: "Modal token id (ak-…). Required, non-secret — sent as x-modal-token-id.",
      },
    ],
  },
  {
    id: "github",
    name: "GitHub",
    category: "app",
    isCustom: false,
    family: GITHUB_FAMILY,
    description: "Read + write GitHub repos, issues, PRs.",
    iconSlug: "github",
    authKind: "oauth",
    inputs: [
      overridable("clientId", GITHUB_CLIENT_ID),
      overridableSecret("clientSecret"),
      optional("appSlug"),
    ],
    extras: oauthExtras("https://github.com/settings/developers"),
  },
  {
    id: "github-pat",
    name: "GitHub (Personal Access Token)",
    category: "app",
    isCustom: false,
    family: GITHUB_FAMILY,
    description:
      "Read + write GitHub repos, issues, PRs with a personal access token.",
    iconSlug: "github",
    authKind: "header",
    inputs: headerInputs("api.github.com", "Authorization", "Bearer {value}"),
  },
  {
    id: "github-app",
    name: "GitHub App (installation)",
    category: "app",
    isCustom: false,
    family: GITHUB_FAMILY,
    description:
      "Act as a GitHub App installation. The platform mints short-lived installation tokens (ghs_…) from the app's private key.",
    iconSlug: "github",
    authKind: "github-app",
    inputs: GITHUB_APP_INPUTS,
  },
  {
    id: "github-enterprise",
    name: "GitHub Enterprise",
    category: "app",
    isCustom: false,
    family: GITHUB_ENTERPRISE_FAMILY,
    description:
      "Connect a GitHub Enterprise host so agents can call its API on your behalf.",
    iconSlug: "github-enterprise",
    authKind: "oauth",
    inputs: [
      required("host"),
      required("clientId"),
      requiredSecret("clientSecret"),
      optional("appSlug"),
    ],
    extras: oauthExtras(),
  },
  {
    id: "github-enterprise-pat",
    name: "GitHub Enterprise (Personal Access Token)",
    category: "app",
    isCustom: false,
    family: GITHUB_ENTERPRISE_FAMILY,
    description:
      "Read + write repos, issues, PRs on a GitHub Enterprise host with a personal access token.",
    iconSlug: "github-enterprise",
    authKind: "header",
    inputs: [
      required("host"),
      overridable("headerName", "Authorization"),
      overridable("valueFormat", "Bearer {value}"),
      requiredSecret("value"),
    ],
  },
  {
    id: "github-enterprise-app",
    name: "GitHub Enterprise (App installation)",
    category: "app",
    isCustom: false,
    family: GITHUB_ENTERPRISE_FAMILY,
    description:
      "Act as a GitHub App installation on a GitHub Enterprise host. The platform mints short-lived installation tokens (ghs_…) from the app's private key — usable by bots and scheduled agents, not just interactive sign-in.",
    iconSlug: "github-enterprise",
    authKind: "github-app",
    inputs: [required("host"), ...GITHUB_APP_INPUTS],
  },
  {
    id: "kubernetes",
    name: "Kubernetes / OpenShift",
    category: "app",
    isCustom: false,
    family: KUBERNETES_FAMILY,
    description:
      "kubectl access to a cluster's API server with a service-account token.",
    iconSlug: "kubernetes",
    authKind: "header",
    inputs: [
      {
        name: "host",
        state: "required",
        label: "API server URL",
        hint: "The cluster API endpoint, exactly as you'd pass to `oc login` / `kubectl` — e.g. https://api.my-cluster.example:6443. A bare host[:port] works too.",
      },
      overridable("headerName", "Authorization"),
      overridable("valueFormat", "Bearer {value}"),
      requiredSecret("value"),
      {
        name: "caData",
        state: "optional",
        label: "Cluster CA certificate",
        hint: "Leave blank for a publicly-trusted API endpoint (most managed clusters). For a private or self-signed CA, paste certificate-authority-data from your kubeconfig (base64 or PEM).",
      },
    ],
  },
  {
    id: "spotify",
    name: "Spotify",
    category: "app",
    isCustom: false,
    description: "Read library + control playback on your behalf.",
    iconSlug: "spotify",
    authKind: "oauth",
    inputs: [required("clientId"), requiredSecret("clientSecret")],
    extras: oauthExtras(
      "https://developer.spotify.com/dashboard",
      CALLBACK_URL,
    ),
  },
  {
    id: "slack",
    name: "Slack Account",
    category: "app",
    isCustom: false,
    description:
      "Search, read, and post in Slack on your behalf — backed by Slack's MCP server.",
    iconSlug: "slack",
    authKind: "oauth",
    inputs: [
      overridable("clientId", SLACK_CLIENT_ID),
      overridableSecret("clientSecret"),
    ],
    extras: oauthExtras("https://api.slack.com/apps"),
  },
  ...GOOGLE_SERVICES.map((g): ConnectionTemplateView => ({
    id: g.id,
    name: g.name,
    category: "app",
    isCustom: false,
    description: g.description,
    iconSlug: g.iconSlug ?? g.id,
    authKind: "oauth",
    inputs: [required("clientId"), requiredSecret("clientSecret")],
    extras: oauthExtras("https://console.cloud.google.com/apis/credentials"),
  })),
  {
    id: "custom-header",
    name: "Custom header credential",
    category: "other",
    isCustom: true,
    family: CUSTOM_HEADER_FAMILY,
    description:
      "Inject a header (API key, PAT, bearer) on outbound calls to a host.",
    iconSlug: "key",
    authKind: "header",
    inputs: [
      required("host"),
      required("headerName", "Authorization"),
      required("valueFormat", "Bearer {value}"),
      requiredSecret("value"),
      optional("envName"),
    ],
  },
  {
    id: "custom-client-credentials",
    name: "OAuth client credentials",
    category: "other",
    isCustom: true,
    description:
      "Machine-to-machine OAuth: access tokens are minted from a client ID and secret and injected on outbound calls to a host.",
    iconSlug: "key",
    authKind: "client-credentials",
    inputs: [
      required("host"),
      {
        name: "issuerUrl",
        state: "optional",
        hint: "Leave blank to discover the authorization server from the host.",
      },
      required("clientId"),
      requiredSecret("clientSecret"),
      optional("scopes"),
      optional("audience"),
      required("headerName", "Authorization"),
      required("valueFormat", "Bearer {value}"),
      optional("envName"),
    ],
  },
  {
    id: "custom-mcp-oauth",
    name: "Custom MCP server (OAuth)",
    category: "mcp",
    isCustom: true,
    family: MCP_SERVER_FAMILY,
    description:
      "MCP server that authenticates with OAuth — discovery + DCR run at create time.",
    iconSlug: "mcp",
    authKind: "oauth",
    inputs: [
      required("url"),
      optional("clientId"),
      { name: "clientSecret", state: "optional", secret: true },
    ],
  },
  {
    id: "custom-mcp-none",
    name: "Custom MCP server (no auth)",
    category: "mcp",
    isCustom: true,
    family: MCP_SERVER_FAMILY,
    description: "Add an MCP server by URL with no authentication.",
    iconSlug: "mcp",
    authKind: "none",
    inputs: [
      required("url"),
      optional("headerName"),
      { name: "value", state: "optional", secret: true },
    ],
  },
];

// Contributions each connection carries, as build-connection.ts derives them.
const GITHUB_CONTRIBUTIONS: Contribution[] = [
  { kind: "env", name: "GH_TOKEN", placeholder: PLACEHOLDER },
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
];

function hostsOf(contributions: Contribution[]): string[] {
  return contributions.flatMap((c) =>
    c.kind === "egress-allow" || c.kind === "egress-inject" ? [c.host] : [],
  );
}

function connection(
  over: Omit<ConnectionView, "ownerId" | "hosts" | "status"> &
    Partial<Pick<ConnectionView, "status">>,
): ConnectionView {
  return {
    ownerId: IDS.owner,
    status: "active",
    hosts: hostsOf(over.contributions),
    ...over,
  };
}

export const CONNECTIONS: ConnectionView[] = [
  connection({
    id: "conn-anthropic",
    templateId: "anthropic",
    category: "app",
    name: "anthropic",
    authKind: "header",
    contributions: [
      { kind: "env", name: "ANTHROPIC_API_KEY", placeholder: PLACEHOLDER },
      {
        kind: "egress-inject",
        host: "api.anthropic.com",
        headerName: "x-api-key",
        valueFormat: "{value}",
      },
    ],
  }),
  connection({
    id: "conn-openai",
    templateId: "openai",
    category: "app",
    name: "openai",
    authKind: "header",
    contributions: [
      { kind: "env", name: "OPENAI_API_KEY", placeholder: PLACEHOLDER },
      {
        kind: "env",
        name: "OPENAI_BASE_URL",
        placeholder: "https://api.openai.com/v1",
      },
      {
        kind: "egress-inject",
        host: "api.openai.com",
        pathPattern: "/v1/*",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
    ],
  }),
  connection({
    id: "conn-github",
    templateId: "github",
    category: "app",
    name: "github",
    authKind: "oauth",
    contributions: GITHUB_CONTRIBUTIONS,
    connectedAt: ago(60 * 24 * 21),
    githubUserToken: {},
  }),
  connection({
    id: "conn-slack",
    templateId: "slack",
    category: "app",
    name: "slack",
    authKind: "oauth",
    contributions: [
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
        headers: { Authorization: `Bearer ${PLACEHOLDER}` },
      },
    ],
    connectedAt: ago(60 * 24 * 9),
  }),
  connection({
    id: "conn-k8s-staging",
    templateId: "kubernetes",
    category: "app",
    name: "staging-cluster",
    authKind: "header",
    contributions: [
      {
        kind: "egress-inject",
        host: "api.staging.k8s.example.com",
        port: 6443,
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
    ],
  }),
  connection({
    id: "conn-linear",
    templateId: "custom-mcp-oauth",
    category: "mcp",
    name: "linear",
    authKind: "oauth",
    status: "expired",
    contributions: [
      {
        kind: "egress-inject",
        host: "mcp.linear.app",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
      {
        kind: "mcp-entry",
        name: "linear",
        url: "https://mcp.linear.app/mcp",
        headers: { Authorization: `Bearer ${PLACEHOLDER}` },
      },
    ],
    connectedAt: ago(60 * 24 * 40),
  }),
  connection({
    id: "conn-sentry",
    templateId: "custom-header",
    category: "other",
    name: "sentry",
    authKind: "header",
    contributions: [
      {
        kind: "egress-inject",
        host: "sentry.io",
        pathPattern: "/api/*",
        headerName: "Authorization",
        valueFormat: "Bearer {value}",
      },
      { kind: "env", name: "SENTRY_AUTH_TOKEN", placeholder: PLACEHOLDER },
    ],
  }),
];

const connections = () => whenPopulated(CONNECTIONS, []);

/** `helm/values.yaml` `trustedHosts`, in order. */
export const TRUSTED_HOSTS: readonly string[] = [
  "api.anthropic.com",
  "statsig.anthropic.com",
  "claude.ai",
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "nodejs.org",
  "jsr.io",
  "npm.jsr.io",
  "api.npmjs.org",
  "api.osv.dev",
  "deno.land",
  "dl.deno.land",
  "bun.sh",
  "pypi.org",
  "files.pythonhosted.org",
  "conda.anaconda.org",
  "github.com",
  "api.github.com",
  "codeload.github.com",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "quay.io",
  "index.docker.io",
  "registry-1.docker.io",
  "auth.docker.io",
  "production.cloudfront.docker.com",
  "production.cloudflare.docker.com",
  "ghcr.io",
  "pkg-containers.githubusercontent.com",
  "gcr.io",
  "registry.k8s.io",
  "*.pkg.dev",
  "registry.access.redhat.com",
  "proxy.golang.org",
  "sum.golang.org",
  "go.dev",
  "crates.io",
  "index.crates.io",
  "static.crates.io",
  "sh.rustup.rs",
  "static.rust-lang.org",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "mise.jdx.dev",
  "cdn.mise.run",
  "mise-versions.jdx.dev",
  "mise-java.jdx.dev",
  "dist.pkgx.dev",
  "gitlab.com",
  "codeberg.org",
  "download.java.net",
  "api.adoptium.net",
  "repo.maven.apache.org",
  "repo1.maven.org",
  "maven.google.com",
  "services.gradle.org",
  "plugins.gradle.org",
  "plugins-artifacts.gradle.org",
  "rubygems.org",
  "index.rubygems.org",
  "packagist.org",
  "repo.packagist.org",
  "getcomposer.org",
  "api.nuget.org",
  "dot.net",
  "builds.dotnet.microsoft.com",
  "hex.pm",
  "repo.hex.pm",
  "builds.hex.pm",
  "pub.dev",
  "hackage.haskell.org",
  "downloads.haskell.org",
  "www.cpan.org",
  "cpanmetadb.plackperl.org",
  "cpan.metacpan.org",
  "fastapi.metacpan.org",
  "cran.r-project.org",
  "cloud.r-project.org",
  "download.swift.org",
  "center.conan.io",
  "ziglang.org",
  "get.helm.sh",
  "dl.k8s.io",
  "blob.istio.io",
  "istio-release.r2.istio.io",
  "istio-release.storage.googleapis.com",
  "mirror.openshift.com",
  "tuf-repo-cdn.sigstore.dev",
  "dl.google.com",
  "archive.apache.org",
  "tmaproduction.blob.core.windows.net",
  "api.us-east.bob.ibm.com",
  "export.arxiv.org",
  "deb.debian.org",
  "*.kernel.org",
  "*.alpinelinux.org",
];

type Preset = "none" | "trusted" | "all";

const PRESET_BY_AGENT: Record<string, Preset> = {
  [IDS.codingAgent]: "trusted",
  [IDS.kbAgent]: "trusted",
  [IDS.slackAgent]: "trusted",
  [IDS.hibernatedAgent]: "none",
};

type ExtraRule = Omit<
  EgressRuleView,
  "id" | "agentId" | "decidedBy" | "decidedAt"
> & { minutesAgo: number };

/** Rules the owner added by hand or approved from the inbox. */
const EXTRA_RULES: Record<string, ExtraRule[]> = {
  [IDS.codingAgent]: [
    {
      host: "api.stripe.com",
      method: "*",
      pathPattern: "/v1/*",
      verdict: "allow",
      source: "inbox",
      minutesAgo: 60 * 26,
    },
    {
      host: "sandbox.api.paypal.com",
      method: "POST",
      pathPattern: "/v2/checkout/orders",
      verdict: "allow",
      source: "inbox",
      minutesAgo: 60 * 3,
    },
    {
      host: "api.segment.io",
      method: "*",
      pathPattern: "*",
      verdict: "deny",
      source: "manual",
      minutesAgo: 60 * 24 * 4,
    },
  ],
  [IDS.slackAgent]: [
    {
      host: "status.example.com",
      method: "GET",
      pathPattern: "*",
      verdict: "allow",
      source: "manual",
      minutesAgo: 60 * 24 * 2,
    },
  ],
  [IDS.hibernatedAgent]: [
    {
      host: "s3.amazonaws.com",
      method: "*",
      pathPattern: "*",
      verdict: "allow",
      source: "manual",
      minutesAgo: 60 * 24 * 40,
    },
    {
      host: "bigquery.googleapis.com",
      method: "*",
      pathPattern: "*",
      verdict: "allow",
      source: "inbox",
      minutesAgo: 60 * 24 * 12,
    },
  ],
};

function ruleId(agentIndex: number, n: number): string {
  const tail = (agentIndex * 1000 + n).toString(16).padStart(12, "0");
  return `5e1f0c3a-8b2d-4c6e-9a7f-${tail}`;
}

/** What the api-server holds for an agent: connection-derived rows (which
 *  promote a matching preset row), the preset's rows, then the owner's own. */
function rulesFor(agentId: string): EgressRuleView[] {
  const agentIndex = AGENTS.findIndex((a) => a.id === agentId);
  const agent = AGENTS[agentIndex];
  if (!agent) return [];
  const created = agent.createdAt ?? ago(60 * 24 * 12);
  const out: EgressRuleView[] = [];
  const base = {
    agentId,
    method: "*",
    pathPattern: "*",
    verdict: "allow" as const,
    decidedBy: IDS.owner,
  };
  const push = (rule: Omit<EgressRuleView, "id">) =>
    out.push({ id: ruleId(agentIndex, out.length), ...rule });

  const connectionHosts = new Set<string>();
  for (const connId of agent.grantedConnectionIds) {
    const conn = CONNECTIONS.find((c) => c.id === connId);
    if (!conn) continue;
    for (const c of conn.contributions) {
      if (c.kind !== "egress-allow" && c.kind !== "egress-inject") continue;
      connectionHosts.add(c.host);
      push({
        ...base,
        host: c.host,
        ...(c.port ? { port: c.port } : {}),
        pathPattern: c.pathPattern ?? "*",
        decidedAt: created,
        source: `connection:${connId}`,
      });
    }
  }

  const preset = PRESET_BY_AGENT[agentId] ?? "trusted";
  if (preset === "all") {
    push({ ...base, host: "*", decidedAt: created, source: "preset:all" });
  } else if (preset === "trusted") {
    for (const host of TRUSTED_HOSTS) {
      if (connectionHosts.has(host)) continue;
      push({ ...base, host, decidedAt: created, source: "preset:trusted" });
    }
  }

  for (const { minutesAgo, ...rule } of EXTRA_RULES[agentId] ?? []) {
    push({ ...base, ...rule, decidedAt: ago(minutesAgo) });
  }
  return out;
}

export const connectionsEntries = [
  at("connections.listTemplates", TEMPLATES),
  at("connections.list", connections),
  at("connections.get", ({ id }) => {
    const found = connections().find((c) => c.id === id);
    if (!found) throw new NotFound();
    return found;
  }),
  at("connections.getAgentConnections", ({ agentId }) => {
    const agent = whenPopulated(AGENTS, []).find((a) => a.id === agentId);
    if (!agent) throw new NotFound();
    return {
      agentId,
      connections: agent.grantedConnectionIds.map((connectionId) => ({
        connectionId,
        grantedAt: agent.createdAt ?? ago(60 * 24 * 12),
      })),
    };
  }),

  at("egressRules.listForAgent", ({ agentId }) =>
    whenPopulated(rulesFor(agentId), []),
  ),
  at("egressRules.get", ({ id }) => {
    for (const agent of whenPopulated(AGENTS, [])) {
      const found = rulesFor(agent.id).find((r) => r.id === id);
      if (found) return found;
    }
    throw new NotFound();
  }),
  at("egressRules.currentPreset", ({ agentId }) =>
    whenPopulated(PRESET_BY_AGENT[agentId] ?? "none", "none"),
  ),
  at("egressRules.trustedHosts", TRUSTED_HOSTS),
];
