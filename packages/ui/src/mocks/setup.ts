/**
 * UI design-preview mock layer. See ./README.md.
 *
 * Only imported when `VITE_USE_MOCKS=true`. Do not import from production code.
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
  name: "Platform (Mock)",
  short: "platform",
  theme: {
    light: {
      accent: "#1D6BE1",
      accentHover: "#1556B8",
      accentLight: "#eaf2fe",
    },
    dark: { accent: "#3C92FD", accentHover: "#2F88FD", accentLight: "#0f1f3a" },
  },
};

/**
 * Canned responses for tRPC procedures. Empty arrays for list endpoints drive
 * the UI into its "first-time user" empty state — which is exactly what the
 * SetupProgressBar renders on top of. Add entries here as the design surfaces
 * more flows that need non-empty data to render.
 */
const TRPC_RESPONSES: Record<string, unknown> = {
  "agents.list": [],
  "secrets.list": [],
  "connections.list": [],
  "connections.listTemplates": [
    {
      id: "github",
      name: "GitHub",
      category: "app",
      description: "Read + write GitHub repos, issues, PRs.",
      iconSlug: "github",
      authKind: "oauth",
      isCustom: false,
      // Mirrors what the real backend emits when Helm has clientId /
      // clientSecret / appSlug configured — see inputsFor() in
      // packages/api-server/src/modules/connections/domain/connection-template.ts.
      // Without these, the "Customize defaults" section in TemplateCreateForm
      // would render empty in design-preview mode.
      inputs: [
        {
          name: "clientId",
          state: "overridable",
          presetValue: "Iv1.mock-client-id",
        },
        { name: "clientSecret", state: "overridable", secret: true },
        { name: "appSlug", state: "overridable", presetValue: "platform-mock" },
      ],
    },
  ],
  "templates.list": [],
  "instances.list": [],
  "channels.available": [],
  "schedules.list": [],
  "sessions.list": [],
  "egressRules.listForAgent": [],
  "egressRules.trustedHosts": [],
  "egressRules.currentPreset": null,
  "approvals.listForOwner": [],
  "approvals.listForInstance": [],
  "skills.listSkills": [],
  "skills.state": { installed: [], publishable: [] },
  // Used by the from-scratch agent-creation skills step. Empty by default
  // so the wizard renders the "No skill sources yet" empty card; without
  // these the tRPC mock returns null and SkillsCatalogStep crashes on
  // `sources.length`, making the step look missing.
  "skills.sources.list": [],
  "skills.list": [],
  "secrets.getAgentAccess": { secretIds: [] },
  "connections.getAgentConnections": { connectionIds: [] },
};

/** REST endpoints (non-tRPC) the UI hits directly via authFetch. */
const REST_RESPONSES: Record<string, unknown> = {
  "/api/mcp/connections": [],
  "/api/oauth/apps": [],
  "/api/oauth/apps/connections": [],
};

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

/**
 * tRPC httpBatchLink wire format:
 *   URL:  /api/trpc/<proc1>,<proc2>?batch=1&input=<urlencoded-json>
 *   Body (mutations): {"0": input0, "1": input1}
 *   Response:         [{"result":{"data":<value>}}, ...]
 *
 * We don't actually care about inputs — empty/null responses are enough to
 * drive the onboarding UI into its first-time state.
 */
function handleTrpcBatch(path: string): Response {
  const procedures = path
    .replace(/^\/api\/trpc\//, "")
    .split(",")
    .map((p) => decodeURIComponent(p));

  const results = procedures.map((procedure) => {
    const data = procedure in TRPC_RESPONSES ? TRPC_RESPONSES[procedure] : null;
    return { result: { data } };
  });

  return jsonResponse(results);
}

function handleMockRequest(url: string): Response | null {
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
    // Icons etc — a 404 avoids noisy manifest warnings.
    return new Response(null, { status: 404 });
  }
  if (pathname.startsWith("/api/trpc/")) {
    return handleTrpcBatch(pathname);
  }
  if (pathname in REST_RESPONSES) {
    return jsonResponse(REST_RESPONSES[pathname]);
  }
  // Other /api/* — return empty success so unknown flows don't throw.
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
      const mocked = handleMockRequest(url);
      if (mocked) return mocked;
    }
    return originalFetch(input, init);
  };

  console.info(
    "[mocks] UI design-preview mocks active — packages/ui/src/mocks/README.md",
  );
}
