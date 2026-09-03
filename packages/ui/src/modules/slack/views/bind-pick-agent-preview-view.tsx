import { Search } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { ContributionFailuresBadge } from "../../agents/components/contribution-failures-badge.js";

type AgentState = AgentView["state"];

const BLUE_BADGE =
  "border-transparent bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400";

function formatCpu(raw: string): string {
  const m = raw.match(/^(\d+)m$/);
  if (m) return `${Number(m[1]) / 1000} CPU`;
  return `${raw} CPU`;
}

function formatMemory(raw: string): string {
  const gi = raw.match(/^(\d+)Gi$/);
  if (gi) return `${gi[1]} Gi`;
  const mi = raw.match(/^(\d+)Mi$/);
  if (mi) return `${mi[1]} Mi`;
  return raw;
}

function computeSubtitle(size: { cpu?: string; memory?: string }): string {
  const parts: string[] = [];
  if (size.cpu) parts.push(formatCpu(size.cpu));
  if (size.memory) parts.push(formatMemory(size.memory));
  return parts.join(" · ") || "";
}

function StateBadge({
  state,
  neverHibernates,
  overBudget,
}: {
  state: AgentState;
  neverHibernates: boolean;
  overBudget: boolean;
}) {
  if (overBudget) return <Badge variant="warning">Over budget</Badge>;
  if (state === "running") {
    return (
      <Badge variant="success">
        {neverHibernates ? "Working (Always-on)" : "Working"}
      </Badge>
    );
  }
  if (state === "hibernating" || state === "hibernated") {
    if (neverHibernates) {
      return <Badge className={BLUE_BADGE}>Idle (Always-on)</Badge>;
    }
    return <Badge variant="muted">Hibernating</Badge>;
  }
  if (state === "starting" || state === "preparing_workspace") {
    return <Badge variant="warning">Starting</Badge>;
  }
  if (state === "error") return <Badge variant="danger">Error</Badge>;
  return <Badge variant="muted">{state}</Badge>;
}

interface DummyAgent {
  id: string;
  name: string;
  description?: string;
  state: AgentState;
  neverHibernates: boolean;
  overBudget: boolean;
  overBudgetMessage?: string;
  size?: { cpu?: string; memory?: string };
  slackChannels: string[];
  scheduleCount: number;
  contributionFailures: AgentView["contributionFailures"];
  recent?: boolean;
}

const DUMMY_AGENTS: DummyAgent[] = [
  {
    id: "1", name: "Jamies-Bot", description: "General-purpose coding assistant",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [], recent: true,
  },
  {
    id: "2", name: "deploy-orchestrator", description: "Manages staging and production deploys",
    state: "running", neverHibernates: true, overBudget: false,
    size: { cpu: "4000m", memory: "4Gi" }, slackChannels: ["#deployments", "#alerts"], scheduleCount: 3,
    contributionFailures: [], recent: true,
  },
  {
    id: "3", name: "PR-Reviewer", description: "Automated pull request reviews",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: ["#code-reviews"], scheduleCount: 0,
    contributionFailures: [], recent: true,
  },
  {
    id: "4", name: "nightly-runner", description: "Runs and reports on test suites",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: ["#eng-standup"], scheduleCount: 1,
    contributionFailures: [],
  },
  {
    id: "5", name: "weekend-reviewer", description: "Reviews PRs queued over weekends",
    state: "hibernated", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "6", name: "background-watcher", description: "Monitors infrastructure health",
    state: "hibernated", neverHibernates: true, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: ["#incident-room"], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "7", name: "cost-runaway", description: "Budget monitoring agent",
    state: "hibernated", neverHibernates: true, overBudget: true,
    overBudgetMessage: "Exceeded $200 daily spend limit",
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "8", name: "team-wiki", description: "Knowledge base for team docs",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: ["#team-wiki"], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "9", name: "broken-pipeline", description: "CI/CD pipeline agent",
    state: "error", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [
      { kind: "git-clone", message: "Failed to clone: SSH key expired" },
      { kind: "connection", message: "Slack token revoked" },
    ],
  },
  {
    id: "10", name: "Docs-Writer", description: "Generates and updates documentation",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "11", name: "Incident-Responder", description: "On-call triage and escalation",
    state: "running", neverHibernates: true, overBudget: false,
    size: { cpu: "4000m", memory: "4Gi" }, slackChannels: ["#incidents", "#oncall"], scheduleCount: 2,
    contributionFailures: [],
  },
  {
    id: "12", name: "Metrics-Bot", description: "Pulls dashboards and alerts into chat",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: ["#metrics"], scheduleCount: 1,
    contributionFailures: [],
  },
  {
    id: "13", name: "Security-Scanner", description: "Scans PRs for vulnerabilities",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "14", name: "Release-Notes", description: "Drafts changelogs from merged PRs",
    state: "hibernated", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "15", name: "Design-Sync", description: "Keeps Figma and code in sync",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: ["#design-dev"], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "16", name: "DB-Migration", description: "Reviews and runs database migrations",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "17", name: "Perf-Monitor", description: "Tracks regressions in benchmarks",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 1,
    contributionFailures: [],
  },
  {
    id: "18", name: "Linter-Bot", description: "Enforces code style across the repo",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "19", name: "Dependency-Bot", description: "Monitors and updates dependencies",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "20", name: "API-Tester", description: "Validates API contracts and schemas",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "21", name: "Cache-Tuner", description: "Optimizes caching strategies",
    state: "hibernated", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "22", name: "Log-Analyzer", description: "Summarizes error patterns from logs",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: ["#alerts"], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "23", name: "Sprint-Planner", description: "Helps scope and estimate tickets",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "24", name: "Standup-Bot", description: "Collects and posts daily standups",
    state: "running", neverHibernates: true, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: ["#standups"], scheduleCount: 1,
    contributionFailures: [],
  },
  {
    id: "25", name: "Feature-Flagger", description: "Manages feature flag rollouts",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "26", name: "A11y-Checker", description: "Audits pages for accessibility issues",
    state: "hibernated", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "27", name: "i18n-Bot", description: "Extracts and manages translation strings",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
  {
    id: "28", name: "Infra-Bot", description: "Provisions and tears down environments",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "4000m", memory: "4Gi" }, slackChannels: ["#infra"], scheduleCount: 2,
    contributionFailures: [],
  },
  {
    id: "29", name: "Backup-Monitor", description: "Verifies backup jobs completed",
    state: "running", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 1,
    contributionFailures: [],
  },
  {
    id: "30", name: "Retro-Bot", description: "Facilitates async retrospectives",
    state: "hibernated", neverHibernates: false, overBudget: false,
    size: { cpu: "2000m", memory: "2Gi" }, slackChannels: [], scheduleCount: 0,
    contributionFailures: [],
  },
];

export function BindPickAgentPreviewView() {
  const channelTitle = "#design-dev";
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return DUMMY_AGENTS;
    const q = query.toLowerCase();
    return DUMMY_AGENTS.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description?.toLowerCase().includes(q) ?? false),
    );
  }, [query]);

  const recentAgents = filtered.filter((a) => a.recent);
  const restAgents = filtered
    .filter((a) => !a.recent)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="mx-auto w-full max-w-[960px] flex-1 px-4 md:px-[5%] py-6 md:py-10 flex flex-col gap-6 pb-24">
        <div className="flex items-center gap-3">
          <img src="/icons/slack.svg" alt="" width={32} height={32} />
          <h1 className="text-2xl font-semibold">
            Pick an agent for {channelTitle}
          </h1>
        </div>

        <p className="text-sm text-muted-foreground">
          Choose which agent to add to this channel. You can add more agents to
          the same channel later.
        </p>

        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            className="h-10 pl-9"
            placeholder="Search agents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="flex flex-col gap-5">
          {recentAgents.length > 0 && (
            <AgentSection label="Most recent">
              {recentAgents.map((agent) => (
                <PickerAgentRow
                  key={agent.id}
                  agent={agent}
                  selected={selected === agent.id}
                  onPick={() => setSelected(agent.id)}
                />
              ))}
            </AgentSection>
          )}

          {restAgents.length > 0 && (
            <AgentSection label="A – Z">
              {restAgents.map((agent) => (
                <PickerAgentRow
                  key={agent.id}
                  agent={agent}
                  selected={selected === agent.id}
                  onPick={() => setSelected(agent.id)}
                />
              ))}
            </AgentSection>
          )}

          {filtered.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No agents match &ldquo;{query}&rdquo;
            </p>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 border-t border-border bg-background px-4 py-4">
        <div className="mx-auto flex w-full max-w-[960px] justify-end md:px-[5%]">
          <Button
            type="button"
            disabled={!selected}
            onClick={() => window.location.assign("/bind-success-preview")}
          >
            Add to channel
          </Button>
        </div>
      </div>
    </div>
  );
}

function AgentSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

function PickerAgentRow({
  agent,
  selected,
  onPick,
}: {
  agent: DummyAgent;
  selected: boolean;
  onPick: () => void;
}) {
  const maxVisibleSlack = 2;
  const visibleSlack = agent.slackChannels.slice(0, maxVisibleSlack);
  const slackOverflow = agent.slackChannels.length - visibleSlack.length;

  const hasSlack = agent.slackChannels.length > 0;
  const hasSchedules = agent.scheduleCount > 0;
  const hasMeta = hasSlack || hasSchedules;

  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        CARD_SURFACE,
        "cursor-pointer text-left transition-colors hover:bg-muted/40",
        selected && "border-foreground bg-muted/60",
      )}
    >
      <div className="flex items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate text-base font-semibold text-foreground">
              {agent.name}
            </h2>
            <ContributionFailuresBadge failures={agent.contributionFailures} />
          </div>

          {agent.size && computeSubtitle(agent.size) && (
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {computeSubtitle(agent.size)}
            </p>
          )}

          {hasMeta && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {hasSlack && (
                <Badge variant="muted" className="gap-1.5">
                  <ConnectionIcon iconSlug="slack" alt="" size={16} />
                  {visibleSlack.join(", ")}
                  {slackOverflow > 0 && `, +${slackOverflow}`}
                </Badge>
              )}
              {hasSchedules && (
                <Badge variant="muted">
                  {agent.scheduleCount} active schedule
                  {agent.scheduleCount === 1 ? "" : "s"}
                </Badge>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center">
          <StateBadge
            state={agent.state}
            neverHibernates={agent.neverHibernates}
            overBudget={agent.overBudget}
          />
        </div>
      </div>
    </button>
  );
}
