import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { KcPage } from "./kc.gen.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {!window.kcContext ? (
      <h1>No Keycloak Context</h1>
    ) : (
      <KcPage kcContext={window.kcContext} />
    )}
  </StrictMode>,
);
