import "./App.css";
import "./modules/usage/devtools.js";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { initAuth } from "./auth.js";
import { applyBrand, loadBrand } from "./brand.js";
import { routeToPath } from "./modules/platform/lib/routes.js";
import { preflightTermsGate } from "./modules/terms/lib/preflight.js";
import { queryClient } from "./query-client.js";
import { useStore } from "./store.js";

async function main() {
  if (import.meta.env.VITE_MOCK) {
    const { worker } = await import("./mock/browser.js");
    await worker.start({ onUnhandledRequest: "warn" });
    await loadBrand().then(applyBrand);
    const { default: App } = await import("./app.js");
    const { MockToggle } = await import("./mock/mock-toggle.js");
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={200}>
            <App />
            <MockToggle />
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    return;
  }

  // Brand fetch is unauthenticated and runs in parallel with auth init so the
  // post-login render starts with the right title + theme colors. A failed
  // fetch falls back to the bundled defaults — login still works.
  const [user] = await Promise.all([initAuth(), loadBrand().then(applyBrand)]);
  if (!user) return; // Redirecting to Keycloak, don't render

  if (!(await preflightTermsGate())) {
    window.history.replaceState({}, "", routeToPath({ view: "terms" }));
    useStore.setState({ view: "terms" });
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

main().catch((err) => {
  document.getElementById("root")!.innerHTML = `<pre style="padding:32px;color:red;font-size:14px">Boot crash:\n${err?.message}\n${err?.stack}</pre>`;
});
