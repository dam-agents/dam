import "./App.css";
import "./modules/usage/devtools.js";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { initAuth } from "./auth.js";
import { applyBrand, loadBrand } from "./brand.js";
import { preflightTermsGate } from "./modules/terms/lib/preflight.js";
import { queryClient } from "./query-client.js";

async function main() {
  // Brand fetch is unauthenticated and runs in parallel with auth init so the
  // post-login render starts with the right title + theme colors. A failed
  // fetch falls back to the bundled defaults — login still works.
  const [user] = await Promise.all([initAuth(), loadBrand().then(applyBrand)]);
  if (!user) return; // Redirecting to Keycloak, don't render

  if (!(await preflightTermsGate())) return;

  const { default: App } = await import("./app.js");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

main();
