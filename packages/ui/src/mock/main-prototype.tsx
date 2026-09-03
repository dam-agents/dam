/**
 * Prototype entry point — zero network calls, zero server required.
 * Seeds all React Query caches synchronously from mock fixtures,
 * applies brand directly, and renders the app. Works from file://.
 */
import "../App.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { applyBrand } from "../brand.js";
import { queryClient } from "../query-client.js";
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

// ─── Hash-based routing for file:// support ─────────────────────────────────
// Intercept ALL clicks in capture phase (fires before React or bubbling).
// Convert <a href="/..."> to hash navigation so file:// doesn't navigate away.

history.pushState = () => {};
history.replaceState = () => {};

// ─── Seed all query caches ───────────────────────────────────────────────────

// The tRPC React Query integration uses query keys in the shape:
// [["procedureName", "split"], { input, type: "query" }]
// But our custom hooks use simpler keys. Seed both patterns.

function trpcKey(proc: string, input?: unknown) {
  const parts = proc.split(".");
  return [parts, { input: input ?? undefined, type: "query" }];
}

// Disable all automatic refetching for the prototype
queryClient.setDefaultOptions({
  queries: {
    retry: false,
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  },
});

// Agents + channels (combined query used by useAgents hook)
queryClient.setQueryData(["agents", "list-with-channels"], {
  list: agents,
  availableChannels: channelsAvailable,
});

// tRPC-style keys for individual procedures
queryClient.setQueryData(trpcKey("agents.list"), agents);
queryClient.setQueryData(trpcKey("channels.available"), channelsAvailable);
queryClient.setQueryData(trpcKey("channels.telegramBot"), null);

// Approvals
queryClient.setQueryData(["approvals", "owner"], approvals);
queryClient.setQueryData(trpcKey("approvals.listForOwner"), approvals);
queryClient.setQueryData(
  trpcKey("approvals.listForInstance"),
  approvals.slice(0, 2),
);

// Terms
queryClient.setQueryData(trpcKey("terms.current"), termsCurrent);
queryClient.setQueryData(
  trpcKey("terms.latestAcceptance"),
  termsLatestAcceptance,
);

// Features
queryClient.setQueryData(trpcKey("features.flags"), featureFlags);

// Connections
queryClient.setQueryData(
  trpcKey("connections.listTemplates"),
  connectionTemplates,
);
queryClient.setQueryData(trpcKey("connections.list"), connections);
queryClient.setQueryData(trpcKey("connections.getAgentConnections"), {
  connections: agentConnections.map((c) => ({ ...c, connectionId: c.id })),
});

// Templates
queryClient.setQueryData(trpcKey("templates.list"), templates);

// Budgets
queryClient.setQueryData(trpcKey("budgets.reserved"), budgetsReserved);

// Experiments
queryClient.setQueryData(trpcKey("experiments.list"), experiments);
queryClient.setQueryData(
  trpcKey("experiments.driverSummaries"),
  driverSummaries,
);

// Schedules
queryClient.setQueryData(trpcKey("schedules.list"), schedules);
queryClient.setQueryData(trpcKey("schedules.listForOwner"), schedules);

// Knowledge bases
queryClient.setQueryData(trpcKey("knowledgeBases.list"), knowledgeBases);

// Artifacts
queryClient.setQueryData(trpcKey("artifactLibrary.list"), artifacts);
queryClient.setQueryData(
  trpcKey("artifactLibrary.listFolders"),
  artifactFolders,
);

// Skills
queryClient.setQueryData(trpcKey("skills.list"), []);
queryClient.setQueryData(trpcKey("skills.state"), {
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
});

// Repos / API keys / Metrics
queryClient.setQueryData(trpcKey("repos.list"), []);
queryClient.setQueryData(trpcKey("apiKeys.list"), []);
queryClient.setQueryData(trpcKey("metrics.usage"), {
  totalTokens: 0,
  totalCostCents: 0,
});

// Egress rules
queryClient.setQueryData(trpcKey("egressRules.list"), [
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
]);

// Harness config
queryClient.setQueryData(trpcKey("harnessConfig.get"), {});
queryClient.setQueryData(trpcKey("harnessConfig.status"), {
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
});
queryClient.setQueryData(trpcKey("harnessConfig.current"), {
  model: "claude-sonnet-4-20250514",
  mode: null,
  configOptions: {},
  availableModels: null,
});

// Files
queryClient.setQueryData(trpcKey("files.list"), [
  { path: "src/middleware/auth.ts", type: "file" },
  { path: "src/middleware/strategies/jwt.ts", type: "file" },
  { path: "src/routes/auth.ts", type: "file" },
  { path: "src/index.ts", type: "file" },
  { path: "package.json", type: "file" },
]);

// ─── Stub fetch: returns proper tRPC responses for refetches ─────────────────

const fixtures: Record<string, unknown> = {
  "agents.list": agents,
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
  "connections.getAgentConnections": {
    connections: agentConnections.map((c) => ({ ...c, connectionId: c.id })),
  },
  "templates.list": templates,
  "budgets.reserved": budgetsReserved,
  "experiments.list": experiments,
  "experiments.driverSummaries": driverSummaries,
  "schedules.list": schedules,
  "knowledgeBases.list": knowledgeBases,
  "artifactLibrary.list": artifacts,
  "artifactLibrary.listFolders": artifactFolders,
  "egressRules.list": [],
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
  "skills.list": [],
  "skills.state": { installed: [], standalone: [], instancePublishes: [] },
  "files.list": [],
};

const originalFetch = window.fetch.bind(window);

window.fetch = async (
  input: RequestInfo | URL,
  _init?: RequestInit,
): Promise<Response> => {
  let url: string;
  if (typeof input === "string") {
    url = input.startsWith("/") ? "http://localhost" + input : input;
  } else if (input instanceof URL) {
    url = input.href;
  } else {
    // Request object — normalize file:// URLs
    const raw = input.url;
    if (raw.startsWith("file:")) {
      try {
        url = "http://localhost" + new URL(raw).pathname;
      } catch {
        url = raw;
      }
    } else {
      url = raw;
    }
  }

  // Pass through external requests (Figma capture, etc.)
  if (url.includes("figma.com") || url.includes("mcp.figma.com")) {
    return originalFetch(input, _init);
  }

  // Handle tRPC batch queries
  if (url.includes("/api/trpc/") || url.includes("/trpc/")) {
    try {
      const parsed = new URL(url);
      const procPath = parsed.pathname.replace(/^.*\/trpc\//, "");
      const procs = procPath.split(",");
      const results = procs.map((proc) => {
        const data = fixtures[proc];
        return { result: { data: data !== undefined ? data : null } };
      });
      return new Response(JSON.stringify(results), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch {
      /* fall through */
    }
  }

  // Handle brand endpoint
  if (url.includes("/api/brand")) {
    return new Response(JSON.stringify(brand), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Default: empty success
  return new Response(JSON.stringify(null), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

// ─── Apply brand directly (no fetch needed) ──────────────────────────────────

applyBrand(brand as Parameters<typeof applyBrand>[0]);

// ─── Render ──────────────────────────────────────────────────────────────────

async function boot() {
  const { default: App } = await import("../app.js");
  const root = createRoot(document.getElementById("root")!);

  function render() {
    root.render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={200}>
            <App key={window.location.hash || "home"} />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
  }

  (window as any).__protoRerender = render;
  render();
}

// Also register hashchange at module level in case boot is slow
window.addEventListener("hashchange", () => {
  if ((window as any).__protoRerender) {
    (window as any).__protoRerender();
  }
});

boot().catch((err) => {
  document.getElementById("root")!.innerHTML =
    `<pre style="padding:32px;color:red;font-size:14px">Boot crash:\n${err?.message}\n${err?.stack}</pre>`;
});
