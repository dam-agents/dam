import { Idea } from "@carbon/icons-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { StatusBadge } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useUpdateAgent } from "../api/mutations.js";
import { startupTips } from "../startup-tips.js";
import type { AgentDisplayState } from "../utils/agent-resolver.js";

interface LayoutProps {
  agent: AgentView;
}

function useTipRotation(agent: string, intervalMs = 6000) {
  const tips = useMemo(() => startupTips(agent), [agent]);
  const [index, setIndex] = useState(() =>
    Math.floor(Math.random() * tips.length),
  );
  useEffect(() => {
    const iv = setInterval(
      () => setIndex((i) => (i + 1) % tips.length),
      intervalMs,
    );
    return () => clearInterval(iv);
  }, [tips.length, intervalMs]);
  return { tip: tips[index]! };
}

function useAlwaysOn(agentId: string) {
  const [applied, setApplied] = useState(false);
  const updateAgent = useUpdateAgent();
  const showConfirm = useStore((s) => s.showConfirm);
  const enable = useCallback(async () => {
    const ok = await showConfirm(
      "This agent will never hibernate — it stays running and consumes resources until you set a timeout again in the agent settings.",
      "Keep always-on",
      { confirmLabel: "Keep always-on" },
    );
    if (!ok) return;
    updateAgent.mutate(
      { id: agentId, hibernationTimeoutMin: 0 },
      { onSuccess: () => setApplied(true) },
    );
  }, [agentId, showConfirm, updateAgent]);
  return { applied, pending: updateAgent.isPending, enable };
}

function StartupOverlay({ agent }: LayoutProps) {
  const [entered, setEntered] = useState(false);
  const [progress, setProgress] = useState(0);
  const { tip } = useTipRotation(agent.name, 5500);
  const { applied, pending, enable } = useAlwaysOn(agent.id);

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), 80);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    const iv = setInterval(
      () => setProgress((p) => (p >= 92 ? 92 : p + Math.random() * 6)),
      900,
    );
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <div className="relative h-1.5 w-full bg-muted/20">
        <div
          className="absolute inset-y-0 left-0 bg-primary rounded-r-full transition-all duration-1000 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center">
        <div
          className={cn(
            "flex flex-col items-center transition-all duration-1000",
            entered ? "opacity-100 scale-100" : "opacity-0 scale-95",
          )}
        >
          <div className="mb-3">
            <StatusBadge state="starting" />
          </div>
          <h2
            className="text-center font-extralight tracking-tighter text-foreground"
            style={{ fontSize: "clamp(2rem, 5.5vw, 4rem)", lineHeight: 1 }}
          >
            {agent.name}
          </h2>

          <div
            className={cn(
              "mt-6 flex max-w-xl items-start justify-center gap-2 transition-all duration-700 delay-500",
              entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
            )}
          >
            <Idea
              size={16}
              className="mt-[3px] shrink-0 text-muted-foreground"
            />
            <p className="text-center text-sm leading-relaxed text-muted-foreground min-h-12 transition-opacity duration-500">
              {tip}
            </p>
          </div>
        </div>
      </div>

      <div
        className={cn(
          "px-8 pb-10 md:px-16 transition-all duration-700 delay-700",
          entered ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8",
        )}
      >
        <div className="mx-auto flex max-w-2xl justify-center">
          {applied ? (
            <p className="text-sm text-primary">
              Always-on enabled, once agent starts up it will stay on
            </p>
          ) : (
            <Button
              variant="outline"
              onClick={enable}
              disabled={pending}
              tooltip="Keep this agent always-on so it responds instantly. It holds its CPU and memory while idle, leaving less budget for other agents."
            >
              {pending ? "Applying…" : "Skip the wait — keep always-on"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function StartupLayoutPicker({
  agent,
}: {
  agent: AgentView;
  state: AgentDisplayState;
}) {
  return (
    <div className="h-full w-full">
      <StartupOverlay agent={agent} />
    </div>
  );
}
