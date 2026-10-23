import "./App.css";
import "./modules/usage/devtools.js";

import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { initAuth } from "./auth.js";
import { applyBrand, loadBrand } from "./brand.js";
import { rememberReturnPath } from "./lib/return-path.js";
import {
  parsePublicAgentPath,
  parseRoute,
  routeToPath,
} from "./modules/platform/lib/routes.js";
import { preflightTermsGate } from "./modules/terms/lib/preflight.js";
import { queryClient } from "./query-client.js";
import { startDraftSync, useStore } from "./store.js";

async function main() {
  if (import.meta.env.VITE_MOCK) {
    try {
      const { worker } = await import("./mock/browser.js");
      await worker.start({ onUnhandledRequest: "warn" });
    } catch (err) {
      console.error("[mock] MSW failed to start:", err);
    }

    const { mockSessions, MOCK_SESSION_IDS, KIT_SESSION_TO_PACK } =
      await import("./mock/data/sessions.js");
    const sessionsByAgent: Record<string, unknown[]> = { ...mockSessions };
    (window as any).__mockListAgentSessions = (agentId: string) =>
      Promise.resolve(sessionsByAgent[agentId] ?? []);

    for (const [agentId, sessions] of Object.entries(sessionsByAgent)) {
      queryClient.setQueryData(["acp-sessions", agentId, "home"], sessions);
    }

    const { agents } = await import("./mock/data/agents.js");

    {
      const { REAL_PACKS } = await import("./modules/packs/data/packs.js");
      const pack = REAL_PACKS[0];
      const agentId = agents[0]?.id;
      if (pack && agentId) {
        useStore.getState().initOnboarding(agentId, pack);
      }
    }

    // Seed mock changes data so DockedChangesPanel renders
    {
      const { seedMockChanges } =
        await import("./modules/changes/api/queries.js");
      const {
        MOCK_CHANGE_SET_LIST,
        MOCK_CHANGE_SET_DIFF,
        MOCK_EMPTY_CHANGE_SET_LIST,
      } = await import("./mock/data/mock-tools-demo.js");
      const { AGENT_IDS } = await import("./mock/data/agents.js");

      const toolsAgent = AGENT_IDS.codexResearch;
      const toolsSession = MOCK_SESSION_IDS.toolsDemo;
      const emptySession = MOCK_SESSION_IDS.emptyState;

      queryClient.setQueryData(
        ["changes", toolsAgent, "list", toolsSession],
        MOCK_CHANGE_SET_LIST,
      );
      queryClient.setQueryData(
        ["changes", toolsAgent, "list", emptySession],
        MOCK_EMPTY_CHANGE_SET_LIST,
      );
      const repoPath = MOCK_CHANGE_SET_LIST.changeSets[0]?.path;
      if (repoPath) {
        queryClient.setQueryData(
          ["changes", toolsAgent, "diff", repoPath, "base"],
          MOCK_CHANGE_SET_DIFF,
        );
      }

      seedMockChanges(
        {
          [`${toolsAgent}:${toolsSession}`]: MOCK_CHANGE_SET_LIST,
          [`${toolsAgent}:${emptySession}`]: MOCK_EMPTY_CHANGE_SET_LIST,
        },
        repoPath
          ? { [`${toolsAgent}:${repoPath}:base`]: MOCK_CHANGE_SET_DIFF }
          : {},
      );
    }

    // Prevent api-health listener from invalidating seeded cache
    onlineManager.setOnline(true);
    onlineManager.setEventListener((setOnline) => {
      setOnline(true);
      return () => {};
    });

    await loadBrand().then(applyBrand);

    const route = parseRoute(window.location.pathname);
    const urlSession =
      route.view === "chat" && "session" in route ? route.session : null;
    const defaultSession = urlSession ?? MOCK_SESSION_IDS.artifact;
    const packId = KIT_SESSION_TO_PACK[defaultSession] ?? null;

    history.replaceState(null, "", `/chat/${agents[0]!.id}`);
    useStore.setState({
      view: "chat",
      selectedAgent: agents[0]!.id,
      expandedSidebarAgents: new Set(agents.map((a) => a.id)),
      sidebarExpanded: true,
    });

    const { default: App } = await import("./app.js");
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={200}>
            <App />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    return;
  }

  const publicAgentId = parsePublicAgentPath(window.location.pathname);
  if (publicAgentId !== null) {
    await loadBrand().then(applyBrand);
    const { renderPublicAgentPage } = await import("./public-agent-page.js");
    await renderPublicAgentPage(publicAgentId);
    return;
  }

  const [user] = await Promise.all([initAuth(), loadBrand().then(applyBrand)]);
  if (!user) return;

  if (!(await preflightTermsGate())) {
    rememberReturnPath("terms");
    window.history.replaceState({}, "", routeToPath({ view: "terms" }));
  }

  startDraftSync(user.profile.sub);

  useStore.getState().hydrateRoute();

  const { default: App } = await import("./app.js");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <App />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

main();
