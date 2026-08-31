import { ArrowLeft } from "@carbon/icons-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { StatusBadge } from "../../../components/status-indicator.js";
import { useStore } from "../../../store.js";

export function ShowcaseView() {
  const [alwaysOn, setAlwaysOn] = useState(true);
  const setView = useStore((s) => s.setView);

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setView("home")}
          aria-label="Back to home"
        >
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-xl font-semibold text-foreground">
          Always-on tag showcase
        </h1>
      </div>

      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={alwaysOn}
            onChange={(e) => setAlwaysOn(e.target.checked)}
            className="size-4 accent-primary"
          />
          Show always-on badge
        </label>
      </div>

      <section className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Agent card with always-on indicator:
        </p>
        <MockAgentCard
          name="Deploy Bot"
          subtitle="Handles CI/CD and deployment workflows"
          kindLabel="Coding"
          kindVariant="accent"
          state="running"
          alwaysOn={alwaysOn}
        />
        <MockAgentCard
          name="Research Agent"
          subtitle="Deep research across codebases and documentation"
          kindLabel="Coding"
          kindVariant="accent"
          state="running"
          alwaysOn={false}
        />
        <MockAgentCard
          name="Code Review"
          subtitle="Reviews PRs and suggests improvements"
          kindLabel="Coding"
          kindVariant="accent"
          state="hibernated"
          alwaysOn={false}
        />
      </section>

      <section className="space-y-2">
        <p className="text-sm font-medium text-foreground">Design notes</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>
            <Badge variant="accent" className="mx-1 align-baseline">
              Always-on
            </Badge>
            badge appears after the kind badge, same size
          </li>
          <li>
            Only shown when agent has hibernationTimeoutMin === 0 and is running
          </li>
          <li>
            Uses <code className="text-xs">accent</code> variant to match the
            Lightning icon in compute widget and lifecycle toggle
          </li>
        </ul>
      </section>
    </div>
  );
}

function MockAgentCard({
  name,
  subtitle,
  kindLabel,
  kindVariant,
  state,
  alwaysOn,
}: {
  name: string;
  subtitle: string;
  kindLabel: string;
  kindVariant: "accent" | "success" | "muted" | "warning" | "default";
  state: "running" | "hibernated";
  alwaysOn: boolean;
}) {
  return (
    <Card className="group flex items-center justify-between gap-3 border border-border p-4">
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
          <h2 className="w-full min-w-0 truncate text-base font-medium text-foreground md:w-auto">
            {name}
          </h2>
          <Badge variant={kindVariant} className="shrink-0">
            {kindLabel}
          </Badge>
          {alwaysOn && state === "running" && (
            <Badge variant="accent" className="shrink-0">
              Always-on
            </Badge>
          )}
        </div>
        <p className="mt-1 truncate text-sm text-muted-foreground">
          {subtitle}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <StatusBadge state={state} />
      </div>
    </Card>
  );
}
