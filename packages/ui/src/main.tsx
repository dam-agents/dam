import "./App.css";
import "./modules/usage/devtools.js";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { api } from "./api.js";
import { initAuth } from "./auth.js";
import { applyBrand, loadBrand } from "./brand.js";
import { rememberReturnPath } from "./lib/return-path.js";
import {
  parsePublicAgentPath,
  parseRoute,
  routeToPath,
} from "./modules/platform/lib/routes.js";
import { queryClient } from "./query-client.js";
import { startDraftSync, useStore } from "./store.js";

async function preflightTermsGate(): Promise<boolean> {
  if (parseRoute(window.location.pathname).view === "terms") return true;
  try {
    const [current, latest] = await Promise.all([
      api.terms.current.query(),
      api.terms.latestAcceptance.query(),
    ]);
    return !!latest && latest.version === current.version;
  } catch {
    return true;
  }
}

async function main() {
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

  useStore.getState().hydrateRoute();
  startDraftSync(user.profile.sub);

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
