import "./App.css";
import "./modules/usage/devtools.js";

import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { api } from "./api.js";
import { initAuth } from "./auth.js";
import { applyBrand, loadBrand } from "./brand.js";
import { queryClient } from "./query-client.js";

async function preflightTermsGate(): Promise<boolean> {
  if (window.location.pathname === "/terms") return true;
  try {
    const [current, latest] = await Promise.all([
      api.terms.current.query(),
      api.terms.latestAcceptance.query(),
    ]);
    if (!latest || latest.version !== current.version) {
      window.location.replace("/terms");
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

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
