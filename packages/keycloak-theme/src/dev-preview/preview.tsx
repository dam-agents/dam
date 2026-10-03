import "../index.css";

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { KcPage } from "../kc.gen.js";
import { ALL_SCENARIOS } from "./scenarios.js";

type ScenarioKey = keyof typeof ALL_SCENARIOS;
const KEYS = Object.keys(ALL_SCENARIOS) as ScenarioKey[];

function Preview() {
  const [scenario, setScenario] = useState<ScenarioKey>("Sign In");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  const kcContext = ALL_SCENARIOS[scenario];

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  return (
    <>
      {/* Toolbar — fixed at top */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 9999,
          display: "flex",
          gap: 8,
          padding: "8px 16px",
          background: "#1a1a1a",
          color: "#fff",
          fontSize: 13,
          fontFamily: "monospace",
          alignItems: "center",
        }}
      >
        <span style={{ opacity: 0.5 }}>Scenario:</span>
        {KEYS.map((k) => (
          <button
            key={k}
            onClick={() => setScenario(k)}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: "none",
              background: scenario === k ? "#0f62fe" : "#333",
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            {k}
          </button>
        ))}
        <span style={{ opacity: 0.5, marginLeft: 16 }}>Theme:</span>
        <button
          onClick={toggleTheme}
          style={{
            padding: "4px 10px",
            borderRadius: 4,
            border: "none",
            background: "#333",
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {theme}
        </button>
      </div>
      {/* Spacer for toolbar */}
      <div style={{ height: 40 }} />
      {/* Keycloak page */}
      <KcPage kcContext={kcContext} />
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
