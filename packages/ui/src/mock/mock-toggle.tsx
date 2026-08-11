import { useState, useSyncExternalStore } from "react";

import { WelcomeModal } from "../components/welcome-modal.js";
import {
  getActiveScenario,
  SCENARIO_OPTIONS,
  setActiveScenario,
  subscribeScenario,
} from "../modules/home/home-scenarios.js";
import { queryClient } from "../query-client.js";
import { mockEmpty, setMockEmpty } from "./handlers.js";

const CODE_STYLES = [
  { id: "", label: "Default" },
  { id: "muted-bg", label: "Muted BG" },
  { id: "pill", label: "Pill" },
  { id: "underline", label: "Underline" },
  { id: "left-bar", label: "Left Bar" },
  { id: "weight-only", label: "Weight Only" },
  { id: "color-accent", label: "Accent Color" },
  { id: "subtle-border", label: "Border Only" },
  { id: "highlight", label: "Highlight" },
  { id: "minimal", label: "Minimal" },
  { id: "soft-fill", label: "Soft Accent Fill" },
] as const;

export function MockToggle() {
  const [empty, setEmpty] = useState(mockEmpty);
  const [showWelcome, setShowWelcome] = useState(false);
  const [codeStyleIdx, setCodeStyleIdx] = useState(0);
  const scenario = useSyncExternalStore(
    subscribeScenario,
    getActiveScenario,
    getActiveScenario,
  );
  const toggle = () => {
    const next = !empty;
    setEmpty(next);
    setMockEmpty(next);
    queryClient.invalidateQueries();
  };

  const cycleScenario = () => {
    const idx = SCENARIO_OPTIONS.findIndex((o) => o.value === scenario);
    const next = SCENARIO_OPTIONS[(idx + 1) % SCENARIO_OPTIONS.length]!;
    setActiveScenario(next.value);
    queryClient.invalidateQueries();
  };

  const cycleCodeStyle = () => {
    const next = (codeStyleIdx + 1) % CODE_STYLES.length;
    setCodeStyleIdx(next);
    const styleId = CODE_STYLES[next]!.id;
    if (styleId) {
      document.documentElement.setAttribute("data-code-style", styleId);
    } else {
      document.documentElement.removeAttribute("data-code-style");
    }
  };

  return (
    <>
      <div className="fixed top-4 right-4 z-[9999] flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={cycleScenario}
          className="flex items-center gap-2 rounded-full border border-accent/30 bg-card px-4 py-2 text-[14px] font-medium text-accent shadow-lg transition-colors hover:bg-accent/5"
        >
          Scenario: {SCENARIO_OPTIONS.find((o) => o.value === scenario)?.label}
        </button>
        <button
          type="button"
          onClick={cycleCodeStyle}
          className="flex items-center gap-2 rounded-full border border-accent/30 bg-card px-4 py-2 text-[14px] font-medium text-accent shadow-lg transition-colors hover:bg-accent/5"
        >
          Code: {CODE_STYLES[codeStyleIdx]!.label}
        </button>
        <button
          type="button"
          onClick={() => setShowWelcome(true)}
          className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[14px] font-medium text-foreground shadow-lg transition-colors hover:bg-muted"
        >
          Welcome Modal
        </button>
        <button
          type="button"
          onClick={toggle}
          className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[14px] font-medium text-foreground shadow-lg transition-colors hover:bg-muted"
        >
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${empty ? "bg-amber-400" : "bg-green-400"}`}
          />
          {empty ? "Empty state" : "Populated"}
        </button>
      </div>
      {showWelcome && (
        <WelcomeModal
          onSelect={() => setShowWelcome(false)}
          onClose={() => setShowWelcome(false)}
        />
      )}
    </>
  );
}
