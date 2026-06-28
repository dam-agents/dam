import "./App.css";
import "./modules/connections/devtools.js";
import "./modules/usage/devtools.js";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { initAuth } from "./auth.js";
import { applyBrand, loadBrand } from "./brand.js";
import { preflightTermsGate } from "./modules/terms/lib/preflight.js";
import { queryClient } from "./query-client.js";
import { useStore } from "./store.js";

async function main() {
  // Brand fetch is unauthenticated and runs in parallel with auth init so the
  // post-login render starts with the right title + theme colors. A failed
  // fetch falls back to the bundled defaults — login still works.
  let user: unknown = null;
  try {
    [user] = await Promise.all([initAuth(), loadBrand().then(applyBrand)]);
  } catch {
    // Dev mode: API unreachable — skip auth and render with mock user
    console.warn("[dev] Auth unavailable, rendering without authentication");
    await loadBrand()
      .then(applyBrand)
      .catch(() => {});
    user = { profile: { name: "Dev User" } };
    // Auto-navigate to mock chat so the full UI renders in dev
    if (window.location.pathname === "/" || window.location.pathname === "") {
      window.history.replaceState({}, "", "/chat/mock-agent");
    }
  }
  if (!user) return; // Redirecting to Keycloak, don't render

  try {
    if (!(await preflightTermsGate())) {
      window.history.replaceState({}, "", "/terms");
      useStore.setState({ view: "terms" });
    }
  } catch {
    // Dev mode: terms gate unreachable — skip
  }

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
