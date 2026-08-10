import { http, HttpResponse } from "msw";

import { agents } from "./data/agents.js";
import { approvals } from "./data/approvals.js";
import { artifactFolders, artifacts } from "./data/artifacts.js";
import { brand } from "./data/brand.js";
import { budgetsReserved } from "./data/budgets.js";
import { channelsAvailable } from "./data/channels.js";
import {
  agentConnections,
  connections,
  connectionTemplates,
} from "./data/connections.js";
import { driverSummaries, experiments } from "./data/experiments.js";
import { featureFlags } from "./data/features.js";
import { knowledgeBases } from "./data/knowledge-bases.js";
import { schedules } from "./data/schedules.js";
import { templates } from "./data/templates.js";
import { termsCurrent, termsLatestAcceptance } from "./data/terms.js";

/** Toggleable mock state — controlled by the floating MockToggle component. */
export let mockEmpty = false;

export function setMockEmpty(value: boolean) {
  mockEmpty = value;
}

function getFixtures(): Record<string, unknown> {
  const empty = mockEmpty;
  return {
    "agents.list": empty ? [] : agents,
    "agents.get": agents[1],
    "channels.available": channelsAvailable,
    "channels.telegramBot": null,
    "approvals.listForOwner": approvals,
    "approvals.listForInstance": approvals.slice(0, 2),
    "terms.current": termsCurrent,
    "terms.latestAcceptance": termsLatestAcceptance,
    "features.flags": featureFlags,
    "connections.listTemplates": connectionTemplates,
    "connections.list": connections,
    "connections.getAgentConnections": { connections: agentConnections.map(c => ({ ...c, connectionId: c.id })) },
    "templates.list": templates,
    "budgets.reserved": budgetsReserved,
    "experiments.list": empty ? [] : experiments,
    "experiments.driverSummaries": empty ? [] : driverSummaries,
    "schedules.list": schedules,
    "knowledgeBases.list": empty ? [] : knowledgeBases,
    "egressRules.list": [
      {
        id: "er-1",
        host: "api.anthropic.com",
        verdict: "allow",
        source: "connection:conn-anthropic",
      },
      {
        id: "er-2",
        host: "github.com",
        verdict: "allow",
        source: "connection:conn-github",
      },
      {
        id: "er-3",
        host: "api.github.com",
        verdict: "allow",
        source: "connection:conn-github",
      },
    ],
    "egressRules.listForAgent": [
      {
        id: "er-1",
        host: "api.anthropic.com",
        pathPattern: "*",
        verdict: "allow",
        source: "connection:conn-anthropic",
        decidedBy: "preset-trusted",
      },
      {
        id: "er-2",
        host: "github.com",
        pathPattern: "*",
        verdict: "allow",
        source: "connection:conn-github",
        decidedBy: "preset-trusted",
      },
    ],
    "egressRules.currentPreset": "trusted",
    "skills.list": [],
    "skills.state": {
      installed: [
        { source: "platform", name: "code-review", version: "1.0.0" },
        { source: "platform", name: "test-runner", version: "1.2.0" },
      ],
      standalone: [
        {
          name: "my-custom-skill",
          description: "A custom skill",
          skillPath: "/skills/my-custom-skill",
          origin: "user",
        },
      ],
      instancePublishes: [],
    },
    "files.list": [],
    "artifactLibrary.list": empty ? [] : artifacts,
    "artifactLibrary.listFolders": empty ? [] : artifactFolders,
    "artifactLibrary.folderShareUrl": null,
    "repos.list": [],
    "apiKeys.list": [],
    "metrics.usage": { totalTokens: 0, totalCostCents: 0 },
    "harnessConfig.get": {},
    "harnessConfig.status": {
      catalog: {
        options: [
          {
            id: "model",
            choices: [
              { value: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
            ],
          },
        ],
      },
    },
    "harnessConfig.current": { model: "claude-sonnet-4-20250514", mode: null, configOptions: {}, availableModels: null },
  };
}

export const handlers = [
  // Agent-specific tRPC (harnessConfig.current, etc.) — must be before the
  // general /api/trpc/* handler so MSW matches the more specific path first.
  http.get(/\/api\/agents\/[^/]+\/trpc\/.*/, ({ request }) => {
    const url = new URL(request.url);
    const pathAfterTrpc = url.pathname.replace(
      /^\/api\/agents\/[^/]+\/trpc\//,
      "",
    );
    const procedures = pathAfterTrpc.split(",");
    const fixtures = getFixtures();

    const results = procedures.map((proc) => {
      const data = fixtures[proc];
      if (data !== undefined) {
        return { result: { data } };
      }
      return { result: { data: null } };
    });

    return HttpResponse.json(results);
  }),

  // tRPC batch queries (GET)
  http.get("/api/trpc/*", ({ request }) => {
    const url = new URL(request.url);
    const procedurePath = url.pathname.replace("/api/trpc/", "");
    const procedures = procedurePath.split(",");
    const fixtures = getFixtures();

    const results = procedures.map((proc) => {
      const data = fixtures[proc];
      if (data !== undefined) {
        return { result: { data } };
      }
      console.warn(`[MSW] Unhandled tRPC query: ${proc}`);
      return { result: { data: null } };
    });

    return HttpResponse.json(results);
  }),

  // tRPC batch mutations (POST)
  http.post("/api/trpc/*", ({ request }) => {
    const url = new URL(request.url);
    const procedurePath = url.pathname.replace("/api/trpc/", "");
    const procedures = procedurePath.split(",");

    const results = procedures.map((proc) => {
      console.info(`[MSW] Mock mutation: ${proc}`);
      if (proc === "agents.create") {
        mockEmpty = false;
        return { result: { data: agents[0] } };
      }
      if (proc === "agents.upgrade") {
        return { result: { data: { ...agents[1], templateUpdate: null } } };
      }
      if (proc === "experiments.createSandbox") {
        mockEmpty = false;
        return { result: { data: agents.find((a) => a.kind === "experiment") ?? agents[0] } };
      }
      if (proc === "knowledgeBases.create") {
        mockEmpty = false;
        return { result: { data: agents.find((a) => a.kind === "knowledge-base") ?? agents[0] } };
      }
      return { result: { data: null } };
    });

    return HttpResponse.json(results);
  }),

  // Brand endpoint
  http.get("/api/brand", () => {
    return HttpResponse.json(brand);
  }),

  // Health endpoint
  http.get("/api/health", () => {
    return HttpResponse.json({ status: "ok" });
  }),

  // Auth config (in case anything tries to fetch it outside the bypassed initAuth)
  http.get("/api/auth/config", () => {
    return HttpResponse.json({
      issuer: "http://localhost:8080/realms/platform",
      clientId: "platform-ui",
    });
  }),

  // Brand sub-assets (manifest, icons)
  http.get("/api/brand/manifest.webmanifest", () => {
    return HttpResponse.json({
      name: "Platform",
      short_name: "Platform",
      start_url: "/",
      display: "standalone",
      theme_color: "#1D6BE1",
      background_color: "#fafaf9",
      icons: [],
    });
  }),

  http.get("/api/brand/icon.svg", () => {
    return new HttpResponse(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#1D6BE1"/></svg>`,
      { headers: { "Content-Type": "image/svg+xml" } },
    );
  }),

  http.get("/api/brand/icon-180.png", () => {
    return new HttpResponse(null, { status: 204 });
  }),

];
