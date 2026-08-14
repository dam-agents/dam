import {
  Chat,
  Chemistry,
  DataConnected,
  OverflowMenuVertical,
} from "@carbon/icons-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { StatusBadge } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";
import { WorkingDots } from "../../sessions/components/working-dots.js";
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
    () => (filter === "all" ? list : list.filter((i) => i.kind === filter)),
    [list, filter],
  );

  if (list.length === 0) return null;

  return (
    <section className="space-y-4" aria-label="Running now">
      <div className="flex items-center gap-2">
        <h2 className="text-[18px] font-semibold text-foreground">
          Running now
        </h2>
        <Badge
          variant="default"
          className="bg-success text-white hover:bg-success"
        >
          {list.length}
        </Badge>
      </div>

      <div className="flex gap-1 border-b border-border">
        {FILTER_TABS.map((tab) => {
          const count =
            tab.value === "all"
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
          No {FILTER_TABS.find((t) => t.value === filter)?.label.toLowerCase()}{" "}
          running.
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

export function RunningCard({ item }: { item: RunningItem }) {
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

  return (
    <Card
      onClick={() => navigateToSandboxHome(item.agentId)}
      className="group flex min-h-[76px] cursor-pointer items-start justify-between gap-3 border border-border p-4 transition-shadow hover:not-has-[button:hover]:shadow-md"
    >
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
        <Chat size={16} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[16px] text-foreground transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">
            {item.agentName}
          </h3>
          <WorkingDots className="text-accent shrink-0" size="sm" />
        </div>
        <p className="mt-1 truncate text-[14px] text-muted-foreground">
          {item.harness} · {item.provider}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-[14px] tabular-nums text-muted-foreground mr-2">
          {formatDuration(Math.max(0, Date.now() - Date.parse(item.startedAt)))}
        </span>
        <StatusBadge state="running" />
        <span onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="Actions">
                <OverflowMenuVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Restart</DropdownMenuItem>
              <DropdownMenuItem>Pause — wakes on next use</DropdownMenuItem>
              <DropdownMenuItem>Stop — until started again</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger">Delete sandbox</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    </Card>
  );
}

function ExperimentCard({ item }: { item: RunningExperiment }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const pct = Math.round((item.completedRuns / item.totalRuns) * 100);

  return (
    <Card
      onClick={() => navigateToSandboxHome(item.agentId)}
      className="group flex min-h-[76px] cursor-pointer items-start justify-between gap-3 border border-border p-4 transition-shadow hover:not-has-[button:hover]:shadow-md"
    >
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
        <Chemistry size={16} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[16px] text-foreground transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">
            {item.experimentName}
          </h3>
          <Badge variant="accent" className="shrink-0">
            Experiment
          </Badge>
        </div>
        <p className="mt-1 truncate text-[14px] text-muted-foreground">
          {item.completedRuns}/{item.totalRuns} runs completed
        </p>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[14px] tabular-nums text-muted-foreground shrink-0">
            {pct}%
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-[14px] tabular-nums text-muted-foreground mr-2">
          {formatDuration(Math.max(0, Date.now() - Date.parse(item.startedAt)))}
        </span>
        <StatusBadge state="running" />
        <span onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="Actions">
                <OverflowMenuVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Restart</DropdownMenuItem>
              <DropdownMenuItem>Pause — wakes on next use</DropdownMenuItem>
              <DropdownMenuItem>Stop — until started again</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger">Delete sandbox</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    </Card>
  );
}

function KnowledgeBaseCard({ item }: { item: RunningKnowledgeBase }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  return (
    <Card
      onClick={() => navigateToSandboxHome(item.agentId)}
      className="group flex min-h-[76px] cursor-pointer items-start justify-between gap-3 border border-border p-4 transition-shadow hover:not-has-[button:hover]:shadow-md"
    >
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
        <DataConnected size={16} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[16px] text-foreground transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">
            {item.agentName}
          </h3>
          <Badge variant="template" className="shrink-0">
            Knowledge base
          </Badge>
        </div>
        <p className="mt-1 truncate text-[14px] text-muted-foreground">
          {item.templateName} · {item.connectionCount} connections
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-[14px] tabular-nums text-muted-foreground mr-2">
          {formatDuration(Math.max(0, Date.now() - Date.parse(item.startedAt)))}
        </span>
        <StatusBadge state="running" />
        <span onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="Actions">
                <OverflowMenuVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Restart</DropdownMenuItem>
              <DropdownMenuItem>Pause — wakes on next use</DropdownMenuItem>
              <DropdownMenuItem>Stop — until started again</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem tone="danger">Delete sandbox</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    </Card>
  );
}
