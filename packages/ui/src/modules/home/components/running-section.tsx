import { useEffect, useState } from "react";

import { Book, Chemistry, ContainerSoftware } from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import {
  type RunningExperiment,
  type RunningItem,
  type RunningKnowledgeBase,
  type RunningSandbox,
  useRunningItems,
} from "../home-running-data.js";
import { DURATION_TICK_MS } from "../home-thresholds.js";
import { formatDuration } from "../lib/format-time.js";

function useTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), DURATION_TICK_MS);
    return () => clearInterval(id);
  }, []);
}

export function RunningSection() {
  const { data: items } = useRunningItems();
  const [expanded, setExpanded] = useState(false);
  useTick();

  const list = items ?? [];
  if (list.length === 0) return null;

  const current = list[0];
  if (!current) return null;
  const remaining = list.length - 1;

  return (
    <section className="space-y-3" aria-label="Running now">
      <div className="flex items-center gap-2">
        <h2 className="text-[18px] font-semibold text-foreground">Running now</h2>
        <Badge variant="default" className="bg-success text-white hover:bg-success">
          {list.length}
        </Badge>
      </div>

      {expanded ? (
        <div className="space-y-2">
          {list.map((item) => (
            <RunningCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div>
          <div className={cn("relative", remaining > 0 && "mb-5")}>
            {remaining >= 2 && (
              <div className="absolute -bottom-3 left-3 right-3 h-3 rounded-b-lg border border-t-0 border-border bg-card/40" />
            )}
            {remaining >= 1 && (
              <div className="absolute -bottom-1.5 left-1.5 right-1.5 h-3 rounded-b-lg border border-t-0 border-border bg-card/70" />
            )}
            <div className="relative z-10">
              <RunningCard item={current} />
            </div>
          </div>
          {remaining > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-[14px] text-muted-foreground hover:text-foreground transition-colors pt-1"
            >
              +{remaining} more running
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function RunningCard({ item }: { item: RunningItem }) {
  switch (item.kind) {
    case "sandbox":
      return <SandboxCard item={item} />;
    case "experiment":
      return <ExperimentCard item={item} />;
    case "knowledge-base":
      return <KnowledgeBaseCard item={item} />;
  }
}

function SandboxCard({ item }: { item: RunningSandbox }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const elapsed = Math.max(0, Date.now() - Date.parse(item.startedAt));

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-success shrink-0 animate-pulse" />
        <button
          type="button"
          onClick={() => navigateToSandboxHome(item.agentId)}
          className="text-[14px] font-medium text-foreground hover:text-accent transition-colors truncate"
        >
          {item.agentName}
        </button>
        <Badge variant="muted" size="sm" className="inline-flex items-center gap-1">
          <ContainerSoftware size={14} />
          Coding Agent
        </Badge>
        <span className="ml-auto text-[14px] tabular-nums text-muted-foreground shrink-0">
          {formatDuration(elapsed)}
        </span>
      </div>
      <p className="text-[14px] text-muted-foreground mt-1.5 truncate">
        {item.task}
      </p>
      <p className="text-[14px] text-muted-foreground/70 mt-0.5">
        {item.harness} · {item.provider}
      </p>
    </div>
  );
}

function ExperimentCard({ item }: { item: RunningExperiment }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const elapsed = Math.max(0, Date.now() - Date.parse(item.startedAt));
  const pct = Math.round((item.completedRuns / item.totalRuns) * 100);

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-success shrink-0 animate-pulse" />
        <button
          type="button"
          onClick={() => navigateToSandboxHome(item.agentId)}
          className="text-[14px] font-medium text-foreground hover:text-accent transition-colors truncate"
        >
          {item.agentName}
        </button>
        <Badge variant="muted" size="sm" className="inline-flex items-center gap-1">
          <Chemistry size={14} />
          Experiment
        </Badge>
        <span className="ml-auto text-[14px] tabular-nums text-muted-foreground shrink-0">
          {formatDuration(elapsed)}
        </span>
      </div>
      <p className="text-[14px] font-medium text-foreground mt-1.5">
        {item.experimentName}
      </p>
      <p className="text-[14px] text-muted-foreground mt-0.5">
        {item.runLabel}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="text-[14px] tabular-nums text-muted-foreground shrink-0">
          {item.completedRuns}/{item.totalRuns} runs
        </span>
      </div>
      {item.runningInvocations > 0 && (
        <p className="text-[14px] text-muted-foreground/70 mt-1">
          {item.runningInvocations} invocations active
        </p>
      )}
    </div>
  );
}

function KnowledgeBaseCard({ item }: { item: RunningKnowledgeBase }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const elapsed = Math.max(0, Date.now() - Date.parse(item.startedAt));

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-success shrink-0 animate-pulse" />
        <button
          type="button"
          onClick={() => navigateToSandboxHome(item.agentId)}
          className="text-[14px] font-medium text-foreground hover:text-accent transition-colors truncate"
        >
          {item.agentName}
        </button>
        <Badge variant="muted" size="sm" className="inline-flex items-center gap-1">
          <Book size={14} />
          Knowledge Base
        </Badge>
        <span className="ml-auto text-[14px] tabular-nums text-muted-foreground shrink-0">
          {formatDuration(elapsed)}
        </span>
      </div>
      <p className="text-[14px] text-muted-foreground mt-1.5 truncate">
        {item.task}
      </p>
      <p className="text-[14px] text-muted-foreground/70 mt-0.5">
        {item.templateName} · {item.connectionCount} connections · {item.documentsIndexed.toLocaleString()} docs indexed
      </p>
    </div>
  );
}
