import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { getBrand } from "./brand.js";
import { fetchPublicAgent } from "./modules/agents/api/public-agent.js";
import {
  type PublicAgentPageState,
  PublicAgentView,
} from "./modules/agents/views/public-agent-view.js";

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
 *
 * It paints before it reads. The document arrives empty, so the first render
 * happens with no agent yet and the public read updates it — a slow read leaves
 * the visitor on the masthead, never on a blank page.
 */
export async function renderPublicAgentPage(agentId: string): Promise<void> {
  applySystemTheme();
  const brand = getBrand();
  const sessionId = new URLSearchParams(window.location.search).get("s");
  const root = createRoot(document.getElementById("root")!);

  const paint = (state: PublicAgentPageState, openPath: string) =>
    root.render(
      <StrictMode>
        <PublicAgentView state={state} brand={brand} openPath={openPath} />
      </StrictMode>,
    );

  paint({ status: "loading" }, "/");

  const agent = await fetchPublicAgent(agentId);
  document.title = agent ? `${agent.name} · ${brand.name}` : brand.name;
  paint(
    { status: "ready", agent },
    agent ? chatPath(agent.agentId, sessionId) : "/",
  );
}
