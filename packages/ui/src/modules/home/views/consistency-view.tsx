import { Chemistry, Folders, Time } from "@carbon/icons-react";
import { Clock, Eye } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { WorkingDots } from "../../sessions/components/working-dots.js";
import {
  ArtifactCard,
  ExperimentCard,
  ScheduleCard,
  SessionFinishedCard,
  SessionRunningCard,
} from "./comparison-view.js";

/* ═══════════════════════════════════════════════════════════════════════════
   Consistency View — compare home page cards with their "real" counterparts
   from other parts of the UI (schedule panel, artifact library, session list,
   experiment dashboard).
   ═══════════════════════════════════════════════════════════════════════════ */

export function ConsistencyView() {
  return (
    <div className="space-y-16 max-w-4xl pb-20">
      <div>
        <h1 className="text-[22px] font-bold text-foreground">
          Card Consistency — Home vs. Existing UI
        </h1>
        <p className="text-[14px] text-muted-foreground mt-1">
          Side-by-side comparison of home page card designs against their
          counterparts in the rest of the app. Use this to spot divergences and
          decide what to unify.
        </p>
      </div>

      {/* ─── SCHEDULES ─── */}
      <ComparisonSection title="Schedules">
        <ComparisonRow label="Home page">
          <ScheduleCard
            name="Daily brand audit"
            cadence="Every weekday at 9:00 AM"
            nextRun="in 3 hr"
            lastResult="success"
          />
        </ComparisonRow>
        <ComparisonRow label="Configure → Schedules tab">
          <ExistingScheduleCard
            name="Daily brand audit"
            cadence="every weekday at 9:00 AM"
            nextRun="in 3 h"
            lastResult="Succeeded"
            enabled={true}
          />
        </ComparisonRow>
      </ComparisonSection>

      {/* ─── SESSIONS ─── */}
      <ComparisonSection title="Sessions">
        <ComparisonRow label="Home page — running">
          <SessionRunningCard
            title="Refactor auth middleware"
            agentName="backend-refactor"
            updatedAt="2 min ago"
          />
        </ComparisonRow>
        <ComparisonRow label="Session sidebar row — running">
          <ExistingSessionRow
            title="Refactor auth middleware"
            timestamp="2 min ago"
            working
            scheduled={false}
          />
        </ComparisonRow>

        <div className="border-t border-border my-6" />

        <ComparisonRow label="Home page — finished (scheduled)">
          <SessionFinishedCard
            title="Daily brand audit"
            agentName="brand-asset-generator"
            updatedAt="6 hr ago"
            scheduled={true}
          />
        </ComparisonRow>
        <ComparisonRow label="Session sidebar row — finished (scheduled)">
          <ExistingSessionRow
            title="Daily brand audit"
            timestamp="6 hr ago"
            working={false}
            scheduled={true}
          />
        </ComparisonRow>
      </ComparisonSection>

      {/* ─── ARTIFACTS ─── */}
      <ComparisonSection title="Artifacts">
        <ComparisonRow label="Home page">
          <ArtifactCard
            title="Spring campaign hero images"
            agentName="brand-asset-generator"
            updatedAt="2 hr ago"
          />
        </ComparisonRow>
        <ComparisonRow label="Artifact library row">
          <ExistingArtifactRow
            title="Spring campaign hero images"
            kind="markdown"
            agentName="brand-asset-generator"
            version={3}
            viewCount={12}
            createdAt="2 hr ago"
          />
        </ComparisonRow>
      </ComparisonSection>

      {/* ─── EXPERIMENTS ─── */}
      <ComparisonSection title="Experiments">
        <ComparisonRow label="Home page — running">
          <ExperimentCard
            agentName="color-palette-testing"
            experimentName="Spring palette — warm vs cool tones"
            status="running"
            runningInvocations={3}
          />
        </ComparisonRow>
        <ComparisonRow label="Experiments page — lineage card">
          <ExistingExperimentCard
            name="Spring palette — warm vs cool tones"
            status="running"
            runCount={3}
          />
        </ComparisonRow>

        <div className="border-t border-border my-6" />

        <ComparisonRow label="Home page — completed">
          <ExperimentCard
            agentName="color-palette-testing"
            experimentName="Spring palette — warm vs cool tones"
            status="completed"
            runningInvocations={0}
            completedRuns={5}
          />
        </ComparisonRow>
        <ComparisonRow label="Experiments page — lineage card (completed)">
          <ExistingExperimentCard
            name="Spring palette — warm vs cool tones"
            status="completed"
            runCount={5}
          />
        </ComparisonRow>
      </ComparisonSection>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Layout helpers
   ═══════════════════════════════════════════════════════════════════════════ */

function ComparisonSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[18px] font-semibold text-foreground mb-4 border-b border-border pb-2">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function ComparisonRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[14px] font-medium text-muted-foreground mb-2">
        {label}
      </p>
      <div className="ml-0">{children}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Replicas of existing UI components (static, non-functional)
   These are styled to match the real components so we can visually compare.
   ═══════════════════════════════════════════════════════════════════════════ */

function ExistingScheduleCard({
  name,
  cadence,
  nextRun,
  lastResult,
  enabled,
}: {
  name: string;
  cadence: string;
  nextRun: string;
  lastResult: string;
  enabled: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] text-foreground">{name}</p>
          <div className="mt-0.5 flex items-center gap-2 text-[14px] text-muted-foreground">
            <span className="truncate">{cadence}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Time size={12} /> {nextRun}
            </span>
          </div>
        </div>

        <Button variant="outline" className="h-[32px] px-3 text-[14px]">
          View results
        </Button>

        <Switch
          checked={enabled}
          onCheckedChange={() => {}}
          label="Disable schedule"
        />

        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Schedule actions"
        >
          ⋮
        </Button>
      </div>
      <div className="flex w-full items-center gap-1 border-t border-border px-4 py-2.5 text-[14px] text-foreground">
        View details ›
      </div>
      {lastResult && (
        <div className="px-4 pb-3 text-[14px] text-muted-foreground">
          Last run:{" "}
          <span
            className={
              lastResult === "Succeeded" ? "text-success" : "text-danger"
            }
          >
            {lastResult}
          </span>
        </div>
      )}
    </div>
  );
}

function ExistingSessionRow({
  title,
  timestamp,
  working,
  scheduled,
}: {
  title: string;
  timestamp: string;
  working: boolean;
  scheduled: boolean;
}) {
  return (
    <div
      className={cn(
        "group relative flex items-center gap-1 px-4 py-3 border border-border rounded-lg transition-colors",
        "hover:bg-muted/60",
      )}
    >
      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[16px] min-w-0 truncate text-foreground">
            {title}
          </span>
          {working && (
            <WorkingDots className="text-accent shrink-0" size="sm" />
          )}
          <span className="ml-auto flex items-center gap-1.5 shrink-0 pl-2">
            {scheduled && (
              <Time
                size={16}
                className="text-foreground"
                aria-label="Scheduled"
              />
            )}
          </span>
        </div>
        <span className="text-[14px] text-muted-foreground">{timestamp}</span>
      </div>
    </div>
  );
}

function ExistingArtifactRow({
  title,
  kind,
  agentName,
  version,
  viewCount,
  createdAt,
}: {
  title: string;
  kind: string;
  agentName: string;
  version: number;
  viewCount: number;
  createdAt: string;
}) {
  return (
    <div className="group flex w-full items-center gap-3 border border-border rounded-lg px-4 py-2.5 text-left transition-colors hover:bg-muted/60">
      <ArtifactKindIcon kind={kind} />
      <div className="min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-[16px] text-foreground">
          {title}
        </span>
        <span className="flex items-center gap-2.5 text-[14px] text-muted-foreground">
          <span className="inline-flex max-w-40 items-center gap-1 rounded-full bg-muted px-2 py-px">
            <Folders size={12} className="shrink-0" />
            <span className="truncate">{agentName}</span>
          </span>
          {version > 1 && (
            <Badge variant="muted" className="text-[14px]">
              v{version}
            </Badge>
          )}
          <span className="inline-flex items-center gap-1">
            <Eye size={12} />
            {viewCount}
          </span>
          <span className="whitespace-nowrap">{createdAt}</span>
        </span>
      </div>
    </div>
  );
}

function ArtifactKindIcon({ kind }: { kind: string }) {
  const label =
    kind === "markdown"
      ? "MD"
      : kind === "html"
        ? "HTML"
        : kind.toUpperCase().slice(0, 3);
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-semibold text-muted-foreground">
      {label}
    </div>
  );
}

function ExistingExperimentCard({
  name,
  status,
  runCount,
}: {
  name: string;
  status: "running" | "completed";
  runCount: number;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 px-[18px] py-4">
        <button
          type="button"
          className="flex shrink-0 items-center justify-center size-5"
        >
          <span
            className="text-[20px] leading-none text-muted-foreground"
            aria-hidden
          >
            ›
          </span>
        </button>

        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="truncate text-[16px] text-foreground">{name}</span>
          <span className="truncate text-[14px] text-muted-foreground">
            {runCount} run{runCount === 1 ? "" : "s"}
          </span>
        </div>

        <span className="ml-auto shrink-0">
          <Badge
            variant={status === "running" ? "default" : "success"}
            className="text-[14px]"
          >
            {status === "running" ? (
              <span className="flex items-center gap-1.5">
                <Chemistry size={14} /> Running
              </span>
            ) : (
              "Completed"
            )}
          </Badge>
        </span>
      </div>
    </div>
  );
}
