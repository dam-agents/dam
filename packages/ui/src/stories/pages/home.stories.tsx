import {
  Add,
  CheckmarkFilled,
  ChevronDown,
  Cube,
  ErrorFilled,
  OverflowMenuVertical,
  Time,
} from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";

import { ListSkeleton } from "@/components/list-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { PageEmptyState } from "@/components/ui/page-empty-state";
import { SectionLabel } from "@/components/ui/section-label";

import { PageShell } from "./_shell";

const meta: Meta = {
  title: "Pages/Home",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

function FeedApprovalCard({
  title,
  agent,
  time,
}: {
  title: string;
  agent: string;
  time: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant="warning">Needs attention</Badge>
          </div>
          <p className="mt-2 text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {agent} · {time}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline">
            Deny
          </Button>
          <Button size="sm">Allow</Button>
          <Button size="icon-xs" variant="ghost">
            <OverflowMenuVertical size={16} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function FeedActiveCard({
  title,
  agent,
  duration,
}: {
  title: string;
  agent: string;
  duration: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {agent} · Running for {duration}
          </p>
        </div>
        <span className="working-dots shrink-0 inline-flex items-center -space-x-[1px]">
          <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
          <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
          <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
        </span>
      </div>
    </div>
  );
}

function FeedFinishedCard({
  title,
  agent,
  time,
  success,
}: {
  title: string;
  agent: string;
  time: string;
  success: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40">
      <div className="flex items-center gap-3">
        {success ? (
          <CheckmarkFilled size={16} className="shrink-0 text-success" />
        ) : (
          <ErrorFilled size={16} className="shrink-0 text-danger" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {agent} · {time}
          </p>
        </div>
      </div>
    </div>
  );
}

function ComputeWidget() {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-medium text-foreground">Compute</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">8 CPU</p>
        <p className="mt-0.5 text-sm text-muted-foreground">8 Gi memory</p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[35%] rounded-full bg-primary" />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          35% of 24 CPU limit
        </p>
      </CardContent>
    </Card>
  );
}

function SpendWidget() {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-medium text-foreground">Spend</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">$142.50</p>
        <p className="mt-0.5 text-sm text-muted-foreground">This month</p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-[28%] rounded-full bg-primary" />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          28% of $500 budget
        </p>
      </CardContent>
    </Card>
  );
}

function ScheduleWidget() {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm font-medium text-foreground">Schedules</p>
        <div className="mt-3 flex flex-col gap-2">
          {[
            { name: "Daily standup digest", next: "Tomorrow 9:00 AM" },
            { name: "Weekly dep audit", next: "Monday 6:00 AM" },
          ].map((s) => (
            <div key={s.name} className="flex items-center gap-2 text-sm">
              <Time size={14} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-foreground">{s.name}</p>
                <p className="text-xs text-muted-foreground">{s.next}</p>
              </div>
            </div>
          ))}
        </div>
        <Button variant="outline" size="sm" className="mt-3 w-full">
          See all
        </Button>
      </CardContent>
    </Card>
  );
}

export const Populated: Story = {
  render: () => (
    <PageShell activeNav="home" maxWidth="1200">
      <p className="text-lg text-muted-foreground">Good morning</p>
      <h1 className="text-[40px] font-bold tracking-[-1px] text-foreground">
        Activity
      </h1>

      <div className="mt-6 grid grid-cols-[1fr_320px] gap-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground"
            >
              All <ChevronDown size={14} />
            </button>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">2</span> running ·{" "}
              <span className="font-medium text-foreground">1</span> to review
            </p>
          </div>

          <FeedApprovalCard
            title="Permission: execute npm install in /workspace"
            agent="ci-pipeline"
            time="2m ago"
          />
          <FeedActiveCard
            title="Fix login redirect loop"
            agent="ci-pipeline"
            duration="12m"
          />
          <FeedActiveCard
            title="Review PR #482 auth changes"
            agent="code-review-bot"
            duration="4m"
          />
          <FeedFinishedCard
            title="Triage issue #1204"
            agent="bug-triage"
            time="1h ago"
            success
          />
          <FeedFinishedCard
            title="Update API reference v3"
            agent="api-docs"
            time="3h ago"
            success
          />
          <FeedFinishedCard
            title="Dependency audit #38"
            agent="pm-standup"
            time="5h ago"
            success={false}
          />
        </div>

        <div className="space-y-4 pt-[37px]">
          <ComputeWidget />
          <SpendWidget />
          <ScheduleWidget />
        </div>
      </div>
    </PageShell>
  ),
};

export const Empty: Story = {
  render: () => (
    <PageShell activeNav="home" maxWidth="1200">
      <p className="text-lg text-muted-foreground">Good morning</p>
      <h1 className="text-[40px] font-bold tracking-[-1px] text-foreground">
        Activity
      </h1>

      <Callout tone="gradient" className="mt-8 p-8">
        <h2 className="text-xl font-semibold text-foreground">
          Welcome to Platform
        </h2>
        <p className="mt-2 max-w-[520px] text-sm text-muted-foreground">
          Run AI agent harnesses in isolated, secure environments. Get started
          by creating your first coding agent or picking a starter kit.
        </p>
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            {
              icon: <Add size={16} />,
              title: "Create coding agent",
              desc: "Set up an agent with a harness, provider, and connections.",
            },
            {
              icon: <Cube size={16} />,
              title: "Begin experiment",
              desc: "Run repeatable evaluations across agent configurations.",
            },
            {
              icon: <Cube size={16} />,
              title: "Start knowledge base",
              desc: "Build a searchable corpus for agent reference.",
            },
          ].map((card) => (
            <button
              key={card.title}
              type="button"
              className="flex flex-col items-start gap-2 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/40"
            >
              <div className="flex size-[38px] items-center justify-center rounded-lg bg-muted text-foreground">
                {card.icon}
              </div>
              <p className="text-sm font-semibold text-foreground">
                {card.title}
              </p>
              <p className="text-sm text-muted-foreground">{card.desc}</p>
            </button>
          ))}
        </div>
      </Callout>
    </PageShell>
  ),
};

export const Loading: Story = {
  render: () => (
    <PageShell activeNav="home" maxWidth="1200">
      <p className="text-lg text-muted-foreground">Good morning</p>
      <h1 className="text-[40px] font-bold tracking-[-1px] text-foreground">
        Activity
      </h1>
      <div className="mt-6">
        <ListSkeleton rows={4} rowHeight={56} />
      </div>
    </PageShell>
  ),
};
