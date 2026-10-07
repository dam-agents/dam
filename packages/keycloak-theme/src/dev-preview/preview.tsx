import "../index.css";

import { Component, StrictMode, useState } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { KcPage } from "../kc.gen.js";
import { SlackDmIllustration } from "../login/components/slack-dm-illustration.js";
import { SlackTeamIllustration } from "../login/components/slack-team-illustration.js";
import { SIGN_IN } from "./scenarios.js";

type Page = "login" | "illustrations";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Preview error boundary:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <pre style={{ padding: 24, color: "red", whiteSpace: "pre-wrap" }}>
          {this.state.error.message}
          {"\n\n"}
          {this.state.error.stack}
        </pre>
      );
    }
    return this.props.children;
  }
}

function IllustrationsStorage() {
  return (
    <div style={{ padding: 40, display: "flex", flexDirection: "column", gap: 48 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
          DM Illustration (hero)
        </h2>
        <div style={{ maxWidth: 900 }}>
          <SlackDmIllustration />
        </div>
      </div>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
          Team Illustration (channels band)
        </h2>
        <div style={{ maxWidth: 900 }}>
          <SlackTeamIllustration />
        </div>
      </div>
    </div>
  );
}

function Preview() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [page, setPage] = useState<Page>("login");

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  };

  return (
    <>
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          zIndex: 9999,
          padding: "6px 12px",
          background: "#1a1a1a",
          borderRadius: "0 0 0 6px",
          fontSize: 12,
          fontFamily: "monospace",
          display: "flex",
          gap: 6,
        }}
      >
        <button
          onClick={() => setPage(page === "login" ? "illustrations" : "login")}
          style={{
            padding: "3px 8px",
            borderRadius: 4,
            border: "none",
            background: page === "illustrations" ? "#0f62fe" : "#333",
            color: "#fff",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {page === "login" ? "illustrations" : "← login"}
        </button>
        <button
          onClick={toggleTheme}
          style={{
            padding: "3px 8px",
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
      <ErrorBoundary>
        {page === "login" ? (
          <KcPage kcContext={SIGN_IN} />
        ) : (
          <IllustrationsStorage />
        )}
      </ErrorBoundary>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
