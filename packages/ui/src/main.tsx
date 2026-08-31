import "./App.css";
import "./modules/usage/devtools.js";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { initAuth } from "./auth.js";
import { applyBrand, loadBrand } from "./brand.js";
import { rememberReturnPath } from "./lib/return-path.js";
import {
  parsePublicAgentPath,
  routeToPath,
} from "./modules/platform/lib/routes.js";
import { preflightTermsGate } from "./modules/terms/lib/preflight.js";
import { queryClient } from "./query-client.js";
import { startDraftSync, useStore } from "./store.js";

function render(App: React.ComponentType) {
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

async function main() {
  const publicAgentId = parsePublicAgentPath(window.location.pathname);
  if (publicAgentId !== null) {
    await loadBrand().then(applyBrand).catch(() => {});
    const { renderPublicAgentPage } = await import("./public-agent-page.js");
    await renderPublicAgentPage(publicAgentId);
    return;
  }

  let user;
  try {
    [user] = await Promise.all([initAuth(), loadBrand().then(applyBrand)]);
  } catch {
    await loadBrand().then(applyBrand).catch(() => {});
  }

  if (!user) {
    useStore.getState().hydrateRoute();
    const { default: App } = await import("./app.js");
    render(App);
    return;
  }

  if (!(await preflightTermsGate())) {
    rememberReturnPath("terms");
    window.history.replaceState({}, "", routeToPath({ view: "terms" }));
  }

  useStore.getState().hydrateRoute();
  startDraftSync(user.profile.sub);

  const { default: App } = await import("./app.js");
  render(App);
}

main();
