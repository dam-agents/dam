import { Check, ChevronRight } from "lucide-react";

import {
  computeOnboardingState,
  firstPendingStep,
  STEP_KEYS,
  type StepKey,
  stepLabels,
  type StepStatus,
} from "../lib/onboarding.js";
import { useAgents, useAgentsList } from "../modules/agents/api/queries.js";
import {
  useAppConnections,
  useMcpConnections,
} from "../modules/connections/api/queries.js";
import { useSecrets } from "../modules/secrets/api/queries.js";
import { useStore } from "../store.js";
import { isCustomSecret, isProviderPresetType } from "../types.js";

export function SetupProgressBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);

  // Gate on every signal the bar reads being loaded — otherwise the bar briefly
  // flashes the wrong state (e.g. step 2 pending for a user who already has
  // connections) while the initial fetches are in flight.
  const onOnboardingView =
    view === "list" || view === "providers" || view === "connections";
  const { isSuccess: agentsLoaded } = useAgents();
  const agents = useAgentsList();
  const { data: secrets = [], isSuccess: secretsLoaded } = useSecrets({
    enabled: onOnboardingView,
  });
  const { data: appConnections = [], isSuccess: appConnectionsLoaded } =
    useAppConnections({ enabled: onOnboardingView });
  const { data: mcpConnections = [], isSuccess: mcpConnectionsLoaded } =
    useMcpConnections({ enabled: onOnboardingView });
  const fullyLoaded =
    agentsLoaded &&
    secretsLoaded &&
    appConnectionsLoaded &&
    mcpConnectionsLoaded;
  const shouldRender = onOnboardingView && fullyLoaded && agents.length === 0;

  if (!shouldRender) return null;

  const hasProvider = secrets.some((s) => isProviderPresetType(s.type));
  const hasConnections =
    appConnections.some((c) => c.status === "connected") ||
    mcpConnections.some((c) => !c.expired) ||
    secrets.some(isCustomSecret);

  const state = computeOnboardingState({
    hasProvider,
    hasConnections,
    hasAgent: false,
  });

  // The mobile compact label points at the next unfinished step so the user
  // always sees what to do next, regardless of which page they're viewing.
  const nextStep: StepKey = firstPendingStep(state) ?? "agent";
  const nextIndex = STEP_KEYS.indexOf(nextStep);

  const handlePillClick = (key: StepKey) => {
    setView(
      key === "provider"
        ? "providers"
        : key === "connections"
          ? "connections"
          : "list",
    );
  };

  return (
    <div
      className="safe-top sticky top-0 z-20 border-b-2 border-border-light bg-bg/95 backdrop-blur-xl"
      role="navigation"
      aria-label="Onboarding progress"
    >
      <div className="mx-auto w-full max-w-[960px] px-4 md:px-[5%] py-2 md:py-3 flex flex-col md:flex-row md:items-center gap-1 md:gap-4">
        <div className="shrink-0 text-[11px] font-bold uppercase tracking-[0.05em] text-text-muted">
          Get started
        </div>

        {/* Desktop: all three steps as pills — clickable to jump to that step */}
        <div className="hidden md:flex items-center gap-2 flex-1 min-w-0">
          {STEP_KEYS.map((key, i) => {
            // On the list view the "agent" pill's target is /list — a no-op.
            // Disable it so the click doesn't look broken.
            const disabled = key === "agent" && view === "list";
            return (
              <StepPill
                key={key}
                index={i}
                label={stepLabels[key]}
                status={state[key]}
                disabled={disabled}
                onClick={() => handlePillClick(key)}
              />
            );
          })}
        </div>

        {/* Mobile: the whole next-step line is tappable and jumps to that step */}
        <button
          type="button"
          onClick={() => handlePillClick(nextStep)}
          className="md:hidden -mx-2 flex items-center gap-2 min-w-0 text-left rounded-lg px-2 py-2 min-h-[44px] active:bg-surface-raised"
          aria-label={`Go to step ${nextIndex + 1}: ${stepLabels[nextStep]}`}
        >
          <span className="min-w-0 flex-1 text-[13px] font-semibold text-text truncate">
            Step {nextIndex + 1} of {STEP_KEYS.length}: {stepLabels[nextStep]}
          </span>
          <ChevronRight size={16} className="shrink-0 text-text-muted" />
        </button>
      </div>
    </div>
  );
}

function StepPill({
  index,
  label,
  status,
  disabled,
  onClick,
}: {
  index: number;
  label: string;
  status: StepStatus;
  disabled?: boolean;
  onClick: () => void;
}) {
  const done = status === "done";
  const interactive = !disabled && !done;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`btn-brutal flex items-center gap-2 rounded-lg border-2 px-2.5 py-1 min-w-0 transition-colors border-border-light ${
        done ? "bg-surface-raised" : "bg-surface"
      } ${interactive ? "hover:border-accent" : ""} ${disabled ? "cursor-default opacity-80" : ""}`}
    >
      <span
        className={`w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-[11px] font-bold ${
          done
            ? "bg-surface-raised text-success"
            : "bg-border-light text-text-secondary"
        }`}
      >
        {done ? <Check size={12} strokeWidth={3} /> : index + 1}
      </span>
      <span
        className={`text-[12px] font-semibold truncate ${
          done ? "text-text-muted" : "text-text-secondary"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
