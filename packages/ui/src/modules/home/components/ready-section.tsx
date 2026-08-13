import {
  Checkmark,
  Code,
  Folders,
  Idea,
  OverflowMenuVertical,
} from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useDigestSince } from "../home-digest-store.js";
import { type ReadyItem, useReadyItems } from "../home-ready-data.js";
import { formatRelative } from "../lib/format-time.js";

const TYPE_BADGE: Record<
  ReadyItem["type"],
  { label: string; variant: "accent" | "muted" | "template" }
> = {
  pr_ready: { label: "PR", variant: "accent" },
  artifact_ready: { label: "Artifact", variant: "template" },
  suggestion: { label: "Suggestion", variant: "muted" },
  run_complete: { label: "Completed", variant: "muted" },
};

type ReadyFilter =
  | "all"
  | "artifact_ready"
  | "run_complete"
  | "pr_ready"
  | "suggestion";

const FILTER_TABS: { value: ReadyFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "artifact_ready", label: "Artifacts" },
  { value: "run_complete", label: "Tasks" },
  { value: "pr_ready", label: "PRs" },
  { value: "suggestion", label: "Suggestions" },
];

export function ReadySection() {
  const digestSince = useDigestSince();
  const { data: items } = useReadyItems(digestSince);
  const [filter, setFilter] = useState<ReadyFilter>("all");

  const list = items ?? [];

  const filtered = useMemo(
    () => (filter === "all" ? list : list.filter((i) => i.type === filter)),
    [list, filter],
  );

  if (list.length === 0) return null;

  return (
    <section className="space-y-4" aria-label="Ready for you">
      <div className="flex items-center gap-2">
        <h2 className="text-[18px] font-semibold text-foreground">
          Ready for you
        </h2>
        <Badge
          variant="default"
          className="bg-accent text-white hover:bg-accent"
        >
          {list.length}
        </Badge>
      </div>

      <div className="flex gap-1 border-b border-border">
        {FILTER_TABS.map((tab) => {
          const count =
            tab.value === "all"
              ? list.length
              : list.filter((i) => i.type === tab.value).length;
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
          ready.
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map((item) => (
            <ReadyCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

const TYPE_ICON: Record<
  ReadyItem["type"],
  React.ComponentType<{ size: number; className?: string }>
> = {
  pr_ready: Code,
  artifact_ready: Folders,
  suggestion: Idea,
  run_complete: Checkmark,
};

export function ReadyCard({ item }: { item: ReadyItem }) {
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const badge = TYPE_BADGE[item.type];
  const Icon = TYPE_ICON[item.type];

  return (
    <Card
      onClick={() => navigateToSandboxHome(item.agentId)}
      className="group flex min-h-[76px] cursor-pointer items-start justify-between gap-3 border border-border p-4 transition-shadow hover:not-has-[button:hover]:shadow-md"
    >
      <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg bg-muted">
        <Icon size={20} className="text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h3 className="truncate text-[16px] text-foreground transition-colors [.group:hover:not(:has(button:hover))_&]:text-primary">
            {item.title}
          </h3>
          <Badge variant={badge.variant} className="shrink-0">
            {badge.label}
          </Badge>
        </div>
        <p className="mt-1 truncate text-[14px] text-muted-foreground">
          {item.agentName}
        </p>
        {item.subtitle && (
          <p className="mt-0.5 truncate text-[14px] text-muted-foreground/70">
            {item.subtitle}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="text-[14px] text-muted-foreground mr-2">
          {formatRelative(item.completedAt)}
        </span>
        <Button
          size="sm"
          variant="outline"
          onClick={(e) => e.stopPropagation()}
        >
          {item.actionLabel}
        </Button>
        <span onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" title="Actions">
                <OverflowMenuVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Mark as seen</DropdownMenuItem>
              <DropdownMenuItem>Dismiss</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    </Card>
  );
}
