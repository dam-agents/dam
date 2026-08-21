import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { getBrand } from "./brand.js";
import { fetchPublicAgent } from "./modules/agents/api/public-agent.js";
import { PublicAgentView } from "./modules/agents/views/public-agent-view.js";

function chatPath(agentId: string, sessionId: string | null): string {
  const base = `/chat/${encodeURIComponent(agentId)}`;
  return sessionId ? `${base}/${encodeURIComponent(sessionId)}` : base;
}

function applySystemTheme(): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () =>
    document.documentElement.classList.toggle("dark", prefersDark.matches);
  apply();
  prefersDark.addEventListener("change", apply);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The entry point for the one route that renders
 * without a signed-in user. It is a separate entry from main.tsx, not a view
 * inside App, because App is reached only after initAuth has either produced a
 * user or redirected to Keycloak. Nothing here touches auth, the terms gate, the
 * tRPC client, or the route store, so an anonymous visitor cannot fall into an
 * authenticated tree.
 */
export async function renderPublicAgentPage(agentId: string): Promise<void> {
  applySystemTheme();
  const agent = await fetchPublicAgent(agentId);
  const brand = getBrand();
  const sessionId = new URLSearchParams(window.location.search).get("s");

  document.title = agent ? `${agent.name} · ${brand.name}` : brand.name;

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <PublicAgentView
        agent={agent}
        brand={brand}
        openPath={agent ? chatPath(agent.agentId, sessionId) : "/"}
      />
    </StrictMode>,
  );
}
