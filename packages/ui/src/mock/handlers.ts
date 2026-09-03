import { http, HttpResponse } from "msw";

import { agents } from "./data/agents.js";
import { approvals } from "./data/approvals.js";
import {
  artifactContents,
  artifactFolders,
  artifactPreviews,
  artifacts,
} from "./data/artifacts.js";
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
export let mockFirstRun = false;

export function setMockEmpty(value: boolean) {
  mockEmpty = value;
  if (value) mockFirstRun = false;
}

export function setMockFirstRun(value: boolean) {
  mockFirstRun = value;
  if (value) mockEmpty = false;
}

function getFixtures(): Record<string, unknown> {
  const empty = mockEmpty;
  const fresh = mockFirstRun;
  return {
    "agents.list": empty || fresh ? [] : agents,
    "agents.get": agents[1],
    "channels.available": fresh ? [] : channelsAvailable,
    "channels.telegramBot": null,
    "approvals.listForOwner": fresh ? [] : approvals,
    "approvals.listForInstance": fresh ? [] : approvals.slice(0, 2),
    "terms.current": termsCurrent,
    "terms.latestAcceptance": termsLatestAcceptance,
    "features.flags": featureFlags,
    "connections.listTemplates": connectionTemplates,
    "connections.list": fresh ? [] : connections,
    "connections.getAgentConnections": fresh
      ? { connections: [] }
      : {
          connections: agentConnections.map((c) => ({
            ...c,
            connectionId: c.id,
          })),
        },
    "templates.list": templates,
    "budgets.reserved": fresh ? [] : budgetsReserved,
    "experiments.list": empty || fresh ? [] : experiments,
    "experiments.driverSummaries": empty || fresh ? [] : driverSummaries,
    "schedules.list": fresh ? [] : schedules,
    "schedules.listForOwner": fresh ? [] : schedules,
    "knowledgeBases.list": empty || fresh ? [] : knowledgeBases,
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
    "skills.sources.list": [],
    "skills.sets.list": [],
    "skills.listWithScan": { skills: [], scannedAt: null, visibility: null },
    "skills.state": fresh
      ? { installed: [], standalone: [], instancePublishes: [] }
      : {
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
    "files.list":
      empty || fresh
        ? []
        : [
            { path: "src/middleware/auth.ts", type: "file" },
            { path: "src/middleware/strategies/jwt.ts", type: "file" },
            { path: "src/middleware/strategies/session.ts", type: "file" },
            { path: "src/routes/auth.ts", type: "file" },
            { path: "src/index.ts", type: "file" },
            { path: "package.json", type: "file" },
          ],
    "artifactLibrary.list": empty || fresh ? [] : artifacts,
    "artifactLibrary.listFolders": empty || fresh ? [] : artifactFolders,
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
    "harnessConfig.current": {
      model: "claude-sonnet-4-20250514",
      mode: null,
      configOptions: {},
      availableModels: null,
    },
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

    const getAgentInput = (
      idx: number,
    ): Record<string, unknown> | undefined => {
      try {
        const raw = url.searchParams.get("input");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed[String(idx)]?.json) return parsed[String(idx)].json;
          if (parsed.json && procedures.length === 1) return parsed.json;
          if (parsed[String(idx)] && !parsed[String(idx)].json)
            return parsed[String(idx)];
          if (parsed.id && procedures.length === 1) return parsed;
        }
      } catch {
        /* ignore */
      }
      return undefined;
    };

    const results = procedures.map((proc, idx) => {
      const inputObj = getAgentInput(idx);

      if (proc === "files.listDirs") {
        const paths = (inputObj?.paths as string[] | undefined) ?? [""];
        const mockTree: Record<
          string,
          {
            path: string;
            ok: true;
            entries: { name: string; type: "file" | "dir" }[];
          }
        > = {
          "": {
            path: "",
            ok: true,
            entries: [
              { name: "src", type: "dir" },
              { name: "tests", type: "dir" },
              { name: "package.json", type: "file" },
              { name: "tsconfig.json", type: "file" },
              { name: "README.md", type: "file" },
            ],
          },
          src: {
            path: "src",
            ok: true,
            entries: [
              { name: "middleware", type: "dir" },
              { name: "routes", type: "dir" },
              { name: "models", type: "dir" },
              { name: "index.ts", type: "file" },
              { name: "config.ts", type: "file" },
            ],
          },
          "src/middleware": {
            path: "src/middleware",
            ok: true,
            entries: [
              { name: "strategies", type: "dir" },
              { name: "auth.ts", type: "file" },
              { name: "rate-limit.ts", type: "file" },
              { name: "logging.ts", type: "file" },
            ],
          },
          "src/middleware/strategies": {
            path: "src/middleware/strategies",
            ok: true,
            entries: [
              { name: "jwt.ts", type: "file" },
              { name: "session.ts", type: "file" },
              { name: "index.ts", type: "file" },
            ],
          },
          "src/routes": {
            path: "src/routes",
            ok: true,
            entries: [
              { name: "auth.ts", type: "file" },
              { name: "users.ts", type: "file" },
              { name: "health.ts", type: "file" },
            ],
          },
          "src/models": {
            path: "src/models",
            ok: true,
            entries: [
              { name: "user.ts", type: "file" },
              { name: "session.ts", type: "file" },
            ],
          },
          tests: {
            path: "tests",
            ok: true,
            entries: [
              { name: "middleware.test.ts", type: "file" },
              { name: "routes.test.ts", type: "file" },
            ],
          },
        };
        const results = paths.map(
          (p: string) =>
            mockTree[p] ?? { path: p, ok: false, error: "not-found" },
        );
        return { result: { data: { results } } };
      }

      if (proc === "artifactLibrary.get") {
        const id = inputObj?.id as string | undefined;
        const art = id ? artifacts.find((a) => a.id === id) : artifacts[0];
        return { result: { data: art ?? null } };
      }
      if (proc === "artifactLibrary.getContent") {
        const id = inputObj?.id as string | undefined;
        const content = id ? (artifactContents[id] ?? null) : null;
        return { result: { data: content } };
      }
      if (proc === "artifactLibrary.preview") {
        const id = inputObj?.id as string | undefined;
        const html = id ? (artifactPreviews[id] ?? null) : null;
        return { result: { data: html } };
      }
      if (proc === "artifactLibrary.listVersions") {
        const id = inputObj?.id as string | undefined;
        const art = id ? artifacts.find((a) => a.id === id) : artifacts[0];
        if (art) {
          const versions = Array.from({ length: art.version }, (_, i) => ({
            version: i + 1,
            createdAt: art.createdAt,
          }));
          return { result: { data: versions } };
        }
        return { result: { data: [] } };
      }

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

    // tRPC batch input: ?input={"0":{"json":{...}}} or per-index ?input[0]=...
    const getInputForIndex = (
      idx: number,
    ): Record<string, unknown> | undefined => {
      try {
        const raw = url.searchParams.get("input");
        if (raw) {
          const parsed = JSON.parse(raw);
          // Batch format: {"0": {"json": {...}}}
          if (parsed[String(idx)]?.json) return parsed[String(idx)].json;
          // Single non-batch: {"json": {...}}
          if (parsed.json && procedures.length === 1) return parsed.json;
          // Direct object (no json wrapper): {"0": {"id": "..."}}
          if (parsed[String(idx)] && !parsed[String(idx)].json)
            return parsed[String(idx)];
          // Direct single: {"id": "..."}
          if (parsed.id && procedures.length === 1) return parsed;
        }
      } catch {
        /* ignore */
      }
      return undefined;
    };

    const results = procedures.map((proc, idx) => {
      const inputObj = getInputForIndex(idx);

      // Dynamic artifact lookups
      if (proc === "artifactLibrary.get") {
        const id = inputObj?.id as string | undefined;
        const art = id ? artifacts.find((a) => a.id === id) : artifacts[0];
        return { result: { data: art ?? null } };
      }
      if (proc === "artifactLibrary.getContent") {
        const id = inputObj?.id as string | undefined;
        const content = id ? (artifactContents[id] ?? null) : null;
        return { result: { data: content } };
      }
      if (proc === "artifactLibrary.preview") {
        const id = inputObj?.id as string | undefined;
        const html = id ? (artifactPreviews[id] ?? null) : null;
        return { result: { data: html } };
      }
      if (proc === "artifactLibrary.listVersions") {
        const id = inputObj?.id as string | undefined;
        const art = id ? artifacts.find((a) => a.id === id) : artifacts[0];
        if (art) {
          const versions = Array.from({ length: art.version }, (_, i) => ({
            version: i + 1,
            createdAt: art.createdAt,
          }));
          return { result: { data: versions } };
        }
        return { result: { data: [] } };
      }

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
        return {
          result: {
            data: agents.find((a) => a.kind === "experiment") ?? agents[0],
          },
        };
      }
      if (proc === "knowledgeBases.create") {
        mockEmpty = false;
        return {
          result: {
            data: agents.find((a) => a.kind === "knowledge-base") ?? agents[0],
          },
        };
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
