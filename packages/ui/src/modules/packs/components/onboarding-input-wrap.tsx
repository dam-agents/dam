import type { ReactNode } from "react";

import { Checkmark, CircleDash, Cube } from "@carbon/icons-react";

import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import { ChatColumn } from "../../sessions/components/chat-column.js";
import { useStore } from "../../../store.js";

export function OnboardingInputWrap({
  agentId,
  children,
}: {
  agentId: string | null;
  children: ReactNode;
}) {
  const state = useStore((s) =>
    agentId ? s.onboardingByAgent.get(agentId) : undefined,
  );
  const dismiss = useStore((s) => s.dismissOnboarding);

  if (!agentId || !state || state.completed) return <>{children}</>;

  const done = state.steps.filter((s) => s.done).length;

  return (
    <>
      <div className="px-4 md:px-8">
        <ChatColumn>
          <div className="flex items-center justify-between rounded-xl border border-preset-border/60 bg-preset-light/40 px-4 py-2">
            <span className="flex items-center gap-2 text-sm font-medium text-preset">
              <Cube size={16} className="shrink-0" />
              {state.packName}
            </span>
            <HoverCard openDelay={150} closeDelay={300}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  className="text-sm text-preset hover:underline"
                >
                  {done}/{state.steps.length} Onboarding tasks complete
                </button>
              </HoverCardTrigger>
              <HoverCardContent side="top" align="end" className="w-72">
                <p className="text-sm font-semibold text-foreground">
                  Finish onboarding
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Complete these tasks to get your agent running.
                </p>
                <ul className="mt-3 flex flex-col gap-2">
                  {state.steps.map((step) => (
                    <li key={step.id} className="flex items-center gap-2">
                      {step.done ? (
                        <Checkmark
                          size={16}
                          className="shrink-0 text-success"
                        />
                      ) : (
                        <CircleDash
                          size={16}
                          className="shrink-0 text-muted-foreground/50"
                        />
                      )}
                      <span
                        className={
                          step.done
                            ? "text-sm text-muted-foreground line-through"
                            : "text-sm text-foreground"
                        }
                      >
                        {step.label}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => dismiss(agentId)}
                  className="mt-3 text-sm text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                >
                  Dismiss
                </button>
              </HoverCardContent>
            </HoverCard>
          </div>
        </ChatColumn>
      </div>
      {children}
    </>
  );
}
