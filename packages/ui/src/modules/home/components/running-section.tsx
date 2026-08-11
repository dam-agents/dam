import { useEffect, useMemo, useState } from "react";

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

type RunningFilter = "all" | "sandbox" | "experiment" | "knowledge-base";

const FILTER_TABS: { value: RunningFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "sandbox", label: "Coding Agents" },
  { value: "experiment", label: "Experiments" },
  { value: "knowledge-base", label: "Knowledge Bases" },
];

export function RunningSection() {
  const { data: items } = useRunningItems();
  const [filter, setFilter] = useState<RunningFilter>("all");
  useTick();

  const list = items ?? [];

  const filtered = useMemo(
    () => filter === "all" ? list : list.filter((i) => i.kind === filter),
    [list, filter],
  );

  if (list.length === 0) return null;

  return (
    <section className="space-y-4" aria-label="Running now">
      <div className="flex items-center gap-2">
        <h2 className="text-[18px] font-semibold text-foreground">Running now</h2>
        <Badge variant="default" className="bg-success text-white hover:bg-success">
          {list.length}
        </Badge>
      </div>

      <div className="flex gap-1 border-b border-border">
        {FILTER_TABS.map((tab) => {
          const count = tab.value === "all"
            ? list.length
            : list.filter((i) => i.kind === tab.value).length;
          if (tab.value !== "all" && count === 0) return null;
          return (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              className={cn(
                "px-3 py-2 text-[14px] font-medium border-b-2 -mb-px transition-colors",
                filter === tab.value
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {count > 0 && (
                <span className="ml-1.5 text-muted-foreground">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="text-[14px] text-muted-foreground py-4">
          No {FILTER_TABS.find((t) => t.value === filter)?.label.toLowerCase()} running.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <RunningCard key={item.id} item={item} />
          ))}
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
