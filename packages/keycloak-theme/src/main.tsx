import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { KcPage } from "./kc.gen.js";

// To preview a specific page during `pnpm dev`, uncomment the block below and
// pick a `pageId`. Re-comment before committing or your bundle bloats with
// mock data.
//
// import { getKcContextMock } from "./login/KcPageStory.js";
// if (import.meta.env.DEV) {
//   window.kcContext = getKcContextMock({ pageId: "login.ftl", overrides: {} });
// }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {!window.kcContext ? (
      <h1>No Keycloak Context</h1>
    ) : (
      <KcPage kcContext={window.kcContext} />
    )}
  </StrictMode>,
);
