import { useEffect, useMemo, useState } from "react";

import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useUpdateAgent } from "../api/mutations.js";

const FIRST_VISIT_DELAY_MS = 4_000;
const REPEAT_VISIT_DELAY_MS = 1_000;

function seenKey(agentId: string): string {
  return `always-on-prompt-seen:${agentId}`;
}

interface Props {
  agentId: string;
}

export function AlwaysOnPrompt({ agentId }: Props) {
  const [visible, setVisible] = useState(false);
  const [applied, setApplied] = useState(false);
  const updateAgent = useUpdateAgent();
  const showConfirm = useStore((s) => s.showConfirm);

  const seenBefore = useMemo(() => {
    try {
      return sessionStorage.getItem(seenKey(agentId)) === "1";
    } catch {
      return false;
    }
  }, [agentId]);

  useEffect(() => {
    try {
      sessionStorage.setItem(seenKey(agentId), "1");
    } catch {
      /* noop */
    }
  }, [agentId]);

  useEffect(() => {
    const delay = seenBefore ? REPEAT_VISIT_DELAY_MS : FIRST_VISIT_DELAY_MS;
    const timer = setTimeout(() => setVisible(true), delay);
    return () => clearTimeout(timer);
  }, [seenBefore]);

  const handleEnable = async () => {
    const ok = await showConfirm(
      "This agent will never hibernate — it stays running and consumes resources until you set a timeout again. You can change this anytime in Agent Setup › Lifecycle.",
      "Keep always-on",
      { confirmLabel: "Keep always-on" },
    );
    if (!ok) return;
    updateAgent.mutate(
      { id: agentId, hibernationTimeoutMin: 0 },
      { onSuccess: () => setApplied(true) },
    );
  };

  if (applied) {
    return (
      <Callout className="w-full max-w-120 p-5 text-left animate-in fade-in duration-300">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Done — this agent will stay on. You won&apos;t see this wait again.
          Change it anytime in Agent Setup › Lifecycle.
        </p>
      </Callout>
    );
  }

  return (
    <Callout
      className={cn(
        "w-full max-w-120 p-5 text-left motion-safe:transition-opacity duration-500",
        visible ? "opacity-100" : "opacity-0 motion-reduce:opacity-100",
      )}
    >
      <p className="text-sm font-medium text-foreground mb-1">
        Skip the wait next time?
      </p>
      <p className="text-sm leading-relaxed text-muted-foreground mb-3">
        Keep this agent always-on so it responds instantly. It holds its CPU and
        memory while idle, leaving less budget for other agents.
      </p>
      <button
        onClick={handleEnable}
        disabled={updateAgent.isPending}
        className="text-sm font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-50"
      >
        {updateAgent.isPending ? "Applying…" : "Keep always-on"}
      </button>
    </Callout>
  );
}
