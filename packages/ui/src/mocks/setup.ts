/**
 * UI design-preview mock layer. See ./README.md.
 *
 * Only imported when `VITE_USE_MOCKS=true`. Do not import from production code.
 *
 * All mock data lives in mutable arrays. Mutations (create/delete) modify
 * these arrays in-place so changes persist for the browser session. Refresh
 * the page to reset to seed data.
 */

const MOCK_ISSUER = "http://mock-oidc.local";
const MOCK_CLIENT_ID = "mock-client";

interface MockBrand {
  name: string;
  short: string;
  theme: {
    light: { accent: string; accentHover: string; accentLight: string };
    dark: { accent: string; accentHover: string; accentLight: string };
  };
}

const MOCK_BRAND: MockBrand = {
  name: "DAM",
  short: "dam",
  theme: {
    light: {
      accent: "#1D6BE1",
      accentHover: "#1556B8",
      accentLight: "#eaf2fe",
    },
    dark: { accent: "#3C92FD", accentHover: "#2F88FD", accentLight: "#0f1f3a" },
  },
};

// ---------------------------------------------------------------------------
// Mutable mock state — mutations modify these, queries read them
// ---------------------------------------------------------------------------

let idCounter = 100;
function nextId(prefix: string) {
  return `${prefix}-${++idCounter}`;
}

const mockState = {
  agents: [
    {
      id: "agent-gw-1",
      name: "gw-agent",
      templateId: "claude-code",
      image: "ghcr.io/dam-agents/agent-claude-code:latest",
      description: "Triages inbox, agenda, and drive activity.",
      state: "running",
      channels: [] as unknown[],
      allowedUserEmails: [] as string[],
    },
  ] as Record<string, unknown>[],

  secrets: [
    {
      id: "sec-anthropic-1",
      name: "Anthropic",
      type: "anthropic",
      hostPattern: "*.anthropic.com",
      createdAt: "2025-04-10T08:00:00Z",
    },
  ] as Record<string, unknown>[],

  connections: [
    {
      id: "conn-gmail-1",
      ownerId: "mock-designer",
      templateId: "google-gmail",
      category: "app",
      name: "Gmail",
      status: "active",
      authKind: "oauth",
      contributions: [],
      connectedAt: "2025-04-12T10:30:00Z",
      hosts: ["gmail.googleapis.com"],
    },
    {
      id: "conn-github-1",
      ownerId: "mock-designer",
      templateId: "github",
      category: "app",
      name: "GitHub",
      status: "active",
      authKind: "oauth",
      contributions: [],
      connectedAt: "2025-04-11T14:00:00Z",
      hosts: ["api.github.com"],
      appSlug: "platform-mock",
    },
  ] as Record<string, unknown>[],

  connectionTemplates: [
    // --- Provider presets (filtered out of connections step by PROVIDER_PRESET_TEMPLATE_IDS) ---
    { id: "anthropic", name: "Anthropic", category: "app", isCustom: false, description: "Anthropic API access (Claude).", iconSlug: "anthropic", authKind: "header", inputs: [{ name: "value", state: "required", secret: true }] },
    { id: "openai", name: "OpenAI", category: "app", isCustom: false, description: "OpenAI API access.", iconSlug: "openai", authKind: "header", inputs: [{ name: "value", state: "required", secret: true }] },
    { id: "ibm-litellm", name: "IBM LiteLLM", category: "app", isCustom: false, description: "IBM internal LiteLLM proxy.", iconSlug: "ibm", authKind: "header", inputs: [{ name: "value", state: "required", secret: true }] },
    { id: "bob", name: "Bob Shell", category: "app", isCustom: false, description: "IBM Bob Shell.", iconSlug: "bob", authKind: "header", inputs: [{ name: "value", state: "required", secret: true }] },
    // --- Apps ---
    { id: "github", name: "GitHub", category: "app", isCustom: false, description: "Read + write GitHub repos, issues, PRs.", iconSlug: "github", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "Iv1.mock-client-id" }, { name: "clientSecret", state: "overridable", secret: true }, { name: "appSlug", state: "overridable", presetValue: "platform-mock" }] },
    { id: "github-enterprise", name: "GitHub Enterprise", category: "app", isCustom: false, description: "GitHub Enterprise Server access.", iconSlug: "github-enterprise", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-gmail", name: "Gmail", category: "app", isCustom: false, description: "Read, compose, and send emails via Gmail.", iconSlug: "gmail", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-drive", name: "Google Drive", category: "app", isCustom: false, description: "Read, create, and manage files and folders.", iconSlug: "google-drive", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-calendar", name: "Google Calendar", category: "app", isCustom: false, description: "Read, create, and manage calendar events.", iconSlug: "google-calendar", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-docs", name: "Google Docs", category: "app", isCustom: false, description: "Read, create, and edit Google Docs documents.", iconSlug: "google-docs", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-sheets", name: "Google Sheets", category: "app", isCustom: false, description: "Read, create, and edit spreadsheets.", iconSlug: "google-sheets", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-slides", name: "Google Slides", category: "app", isCustom: false, description: "Read, create, and edit presentations.", iconSlug: "google-slides", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-meet", name: "Google Meet", category: "app", isCustom: false, description: "Create and manage meetings.", iconSlug: "google-meet", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-photos", name: "Google Photos", category: "app", isCustom: false, description: "Manage photos, videos, and albums.", iconSlug: "google-photos", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-tasks", name: "Google Tasks", category: "app", isCustom: false, description: "Manage task lists and tasks.", iconSlug: "google-tasks", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-admin", name: "Google Admin", category: "app", isCustom: false, description: "Manage users, groups, and devices in Workspace.", iconSlug: "google-admin", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-analytics", name: "Google Analytics", category: "app", isCustom: false, description: "Access report data and run analytics queries.", iconSlug: "google-analytics", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-forms", name: "Google Forms", category: "app", isCustom: false, description: "Read, create, and edit forms and responses.", iconSlug: "google-forms", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-classroom", name: "Google Classroom", category: "app", isCustom: false, description: "Manage classes, rosters, and invitations.", iconSlug: "google-classroom", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "google-search-console", name: "Google Search Console", category: "app", isCustom: false, description: "View search traffic and manage site presence.", iconSlug: "google-search-console", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "youtube", name: "YouTube", category: "app", isCustom: false, description: "Manage playlists, videos, and channel content.", iconSlug: "youtube", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable", presetValue: "mock-google-id" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "spotify", name: "Spotify", category: "app", isCustom: false, description: "Access playlists, player state, and library.", iconSlug: "spotify", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "slack", name: "Slack", category: "app", isCustom: false, description: "Post messages, read channels, respond to mentions.", iconSlug: "slack", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable" }, { name: "clientSecret", state: "overridable", secret: true }] },
    { id: "linear", name: "Linear", category: "app", isCustom: false, description: "Create, update, and triage Linear issues.", iconSlug: "linear", authKind: "oauth", inputs: [{ name: "clientId", state: "overridable" }, { name: "clientSecret", state: "overridable", secret: true }] },
    // --- MCP Servers ---
    { id: "custom-mcp-oauth", name: "Custom MCP server (OAuth)", category: "mcp", isCustom: true, description: "MCP server that authenticates with OAuth — discovery + DCR run at create time.", iconSlug: "mcp", authKind: "oauth", inputs: [{ name: "url", state: "required" }] },
    { id: "custom-mcp-none", name: "Custom MCP server (no auth)", category: "mcp", isCustom: true, description: "Add an MCP server by URL with no authentication.", iconSlug: "mcp", authKind: "none", inputs: [{ name: "url", state: "required" }] },
    // --- Other ---
    { id: "custom-header", name: "Custom header credential", category: "other", isCustom: true, description: "Inject a header (API key, PAT, bearer) on outbound calls to a host.", iconSlug: "key", authKind: "header", inputs: [{ name: "host", state: "required" }, { name: "headerName", state: "required" }, { name: "value", state: "required", secret: true }] },
  ] as Record<string, unknown>[],

  templates: [
    {
      id: "claude-code",
      name: "Claude Code",
      image: "ghcr.io/dam-agents/agent-claude-code:latest",
      description:
        "Anthropic's Claude Code CLI running headless — full agentic coding with tool use.",
    },
    {
      id: "pi-agent",
      name: "Pi Agent",
      image: "ghcr.io/dam-agents/agent-pi:latest",
      description: "Lightweight Python agent harness with MCP tool support.",
    },
  ] as Record<string, unknown>[],

  schedules: [] as Record<string, unknown>[],
  skillSources: [] as Record<string, unknown>[],
};

// ---------------------------------------------------------------------------
// Query resolver — reads live state
// ---------------------------------------------------------------------------

function resolveQuery(procedure: string): unknown {
  switch (procedure) {
    case "agents.list":
      return mockState.agents;
    case "secrets.list":
      return mockState.secrets;
    case "connections.list":
      return mockState.connections;
    case "connections.listTemplates":
      return mockState.connectionTemplates;
    case "templates.list":
      return mockState.templates;
    case "schedules.list":
      return mockState.schedules;
    case "skills.sources.list":
      return mockState.skillSources;
    case "skills.list":
      return [];
    case "skills.listSkills":
      return [];
    case "skills.state":
      return { installed: [], publishable: [] };
    case "instances.list":
      return [];
    case "channels.available":
      return [
        { type: "slack", id: "C01MOCK", name: "#general" },
        { type: "telegram", id: "tg-mock", name: "Design Bot" },
      ];
    case "sessions.list":
      return [];
    case "egressRules.listForAgent":
      return [];
    case "egressRules.trustedHosts":
      return ["registry.npmjs.org", "pypi.org", "api.github.com", "api.anthropic.com"];
    case "egressRules.currentPreset":
      return "trusted";
    case "approvals.listForOwner":
    case "approvals.listForInstance":
      return [];
    case "secrets.getAgentAccess":
      return { secretIds: mockState.secrets.map((s) => s.id) };
    case "connections.getAgentConnections":
      return { connectionIds: mockState.connections.map((c) => c.id) };
    case "terms.getState":
      return { accepted: true };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Mutation handler — modifies live state
// ---------------------------------------------------------------------------

function handleMutation(procedure: string, input: unknown): unknown {
  const data = input as Record<string, unknown> | null;

  switch (procedure) {
    case "agents.create": {
      const agent = {
        id: nextId("agent"),
        name: (data?.name as string) || "new-agent",
        templateId: (data?.templateId as string) || null,
        image: (data?.image as string) || "ghcr.io/dam-agents/agent-claude-code:latest",
        description: (data?.description as string) || undefined,
        state: "running",
        channels: [],
        allowedUserEmails: [],
      };
      mockState.agents.push(agent);
      return agent;
    }
    case "agents.delete": {
      const id = (data?.id as string) ?? "";
      mockState.agents = mockState.agents.filter((a) => a.id !== id);
      return {};
    }
    case "agents.wake":
    case "agents.restart": {
      const id = (data?.id as string) ?? "";
      const agent = mockState.agents.find((a) => a.id === id);
      if (agent) agent.state = "running";
      return {};
    }

    case "secrets.create": {
      const secret = {
        id: nextId("sec"),
        name: (data?.name as string) || "New Provider",
        type: (data?.type as string) || "anthropic",
        hostPattern: "*",
        createdAt: new Date().toISOString(),
        envMappings: data?.envMappings ?? undefined,
      };
      mockState.secrets.push(secret);
      return secret;
    }
    case "secrets.update": {
      const id = (data?.id as string) ?? "";
      const secret = mockState.secrets.find((s) => s.id === id);
      if (secret && data?.envMappings) secret.envMappings = data.envMappings;
      return {};
    }
    case "secrets.remove":
    case "secrets.delete": {
      const id = (data?.id as string) ?? "";
      mockState.secrets = mockState.secrets.filter((s) => s.id !== id);
      return {};
    }
    case "secrets.setAgentAccess":
      return {};

    case "connections.create": {
      const conn = {
        id: nextId("conn"),
        ownerId: "mock-designer",
        templateId: (data?.templateId as string) || "unknown",
        category: "app",
        name: (data?.name as string) || "New Connection",
        status: "active",
        authKind: "oauth",
        contributions: [],
        connectedAt: new Date().toISOString(),
        hosts: [],
      };
      mockState.connections.push(conn);
      return conn;
    }
    case "connections.delete": {
      const id = (data?.id as string) ?? "";
      mockState.connections = mockState.connections.filter((c) => c.id !== id);
      return {};
    }
    case "connections.setAgentConnections":
      return {};

    case "schedules.create": {
      const sched = {
        id: nextId("sched"),
        name: (data?.name as string) || "New Schedule",
        agentId: (data?.agentId as string) || "",
        type: "cron",
        cron: (data?.cron as string) || "0 9 * * *",
        rrule: null,
        timezone: null,
        quietHours: [],
        task: (data?.task as string) || null,
        enabled: true,
        status: null,
      };
      mockState.schedules.push(sched);
      return sched;
    }
    case "schedules.delete": {
      const id = (data?.id as string) ?? "";
      mockState.schedules = mockState.schedules.filter((s) => s.id !== id);
      return {};
    }

    case "skills.sources.create": {
      const src = {
        id: nextId("src"),
        name: (data?.name as string) || "New Source",
        gitUrl: (data?.gitUrl as string) || "",
        system: false,
        fromTemplate: false,
      };
      mockState.skillSources.push(src);
      return src;
    }

    case "terms.accept":
      return {};

    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// REST endpoints
// ---------------------------------------------------------------------------

const REST_RESPONSES: Record<string, unknown> = {
  "/api/mcp/connections": [],
  "/api/oauth/apps": [],
  "/api/oauth/apps/connections": [],
};

// ---------------------------------------------------------------------------
// Fetch interceptor
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function seedFakeOidcUser(): void {
  const key = `oidc.user:${MOCK_ISSUER}:${MOCK_CLIENT_ID}`;
  if (sessionStorage.getItem(key)) return;
  const user = {
    id_token: "mock-id-token",
    session_state: null,
    access_token: "mock-access-token",
    refresh_token: null,
    token_type: "Bearer",
    scope: "openid profile",
    profile: {
      sub: "mock-designer",
      name: "Designer",
      preferred_username: "designer",
    },
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365,
  };
  sessionStorage.setItem(key, JSON.stringify(user));
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function handleTrpcBatch(path: string): Response {
  const procedures = path
    .replace(/^\/api\/trpc\//, "")
    .replace(/^\/api\/agents\/[^/]+\/trpc\//, "")
    .split(",")
    .map((p) => decodeURIComponent(p));

  const results = procedures.map((procedure) => {
    const data = resolveQuery(procedure);
    return { result: { data } };
  });

  return jsonResponse(results);
}

function handleTrpcMutation(path: string, body: string | null): Response {
  const procedures = path
    .replace(/^\/api\/trpc\//, "")
    .replace(/^\/api\/agents\/[^/]+\/trpc\//, "")
    .split(",")
    .map((p) => decodeURIComponent(p));

  let inputs: Record<string, unknown> = {};
  if (body) {
    try {
      inputs = JSON.parse(body);
    } catch {
      // ignore
    }
  }

  const results = procedures.map((procedure, i) => {
    const input = inputs[String(i)] ?? null;
    const data = handleMutation(procedure, input);
    return { result: { data } };
  });

  return jsonResponse(results);
}

function handleMockRequest(
  url: string,
  method: string,
  body: string | null,
): Response | null {
  const pathname = url.startsWith("http")
    ? new URL(url).pathname
    : url.split("?")[0];

  if (pathname === "/api/auth/config") {
    return jsonResponse({ issuer: MOCK_ISSUER, clientId: MOCK_CLIENT_ID });
  }
  if (pathname === "/api/brand") {
    return jsonResponse(MOCK_BRAND);
  }
  if (pathname.startsWith("/api/brand/")) {
    return new Response(null, { status: 404 });
  }

  if (pathname.startsWith("/api/trpc/") || pathname.match(/\/api\/agents\/[^/]+\/trpc\//)) {
    if (method === "POST") {
      return handleTrpcMutation(pathname, body);
    }
    return handleTrpcBatch(pathname);
  }

  if (pathname in REST_RESPONSES) {
    return jsonResponse(REST_RESPONSES[pathname]);
  }

  if (pathname.startsWith("/api/")) {
    return jsonResponse({});
  }
  return null;
}

export async function setupMocks(): Promise<void> {
  seedFakeOidcUser();

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = resolveUrl(input);
    if (url.includes("/api/")) {
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? init.body : null;
      const mocked = handleMockRequest(url, method, body);
      if (mocked) return mocked;
    }
    return originalFetch(input, init);
  };

  console.info(
    "[mocks] Design-preview mocks active. Mutations modify in-memory state. Refresh to reset.",
  );
}
