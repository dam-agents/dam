import "../index.css";

import { Component, StrictMode } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { KcPage } from "../kc.gen.js";
import { SIGN_IN } from "./scenarios.js";

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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <KcPage kcContext={SIGN_IN} />
    </ErrorBoundary>
  </StrictMode>,
);
