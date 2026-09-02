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

async function main() {
  if (import.meta.env.VITE_MOCK) {
    try {
      const { worker } = await import("./mock/browser.js");
      await worker.start({ onUnhandledRequest: "warn" });
    } catch (err) {
      console.error("[mock] MSW failed to start:", err);
    }
    await loadBrand().then(applyBrand);
    const { default: App } = await import("./app.js");
    const { MockStateBar } = await import("./mock/state-bar.js");
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={200}>
            <div className="flex h-dvh flex-col overflow-hidden">
              <MockStateBar />
              <div className="flex-1 min-h-0">
                <App />
              </div>
            </div>
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
