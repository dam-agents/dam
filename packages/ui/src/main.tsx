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
import { routeToPath } from "./modules/platform/lib/routes.js";
import { preflightTermsGate } from "./modules/terms/lib/preflight.js";
import { queryClient } from "./query-client.js";
import { useStore } from "./store.js";

async function main() {
  // Brand fetch is unauthenticated and runs in parallel with auth init so the
  // post-login render starts with the right title + theme colors. A failed
  // fetch falls back to the bundled defaults — login still works.
  const [user] = await Promise.all([initAuth(), loadBrand().then(applyBrand)]);
  if (!user) return; // Redirecting to Keycloak, don't render

  if (!(await preflightTermsGate())) {
    // Park the destination so acceptance resumes it — a bind link's one-shot
    // `?flow=` is spent by then, and dropping it costs another bind command.
    rememberReturnPath("terms");
    window.history.replaceState({}, "", routeToPath({ view: "terms" }));
  }

  // Both interstitials above rewrite the URL after the store derived its route,
  // so re-derive it here: without this the first render is the pre-redirect
  // view (the dashboard) rather than the deep link the user followed.
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
