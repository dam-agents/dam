import {
  Add,
  CheckboxCheckedFilled,
  ChevronDown,
  ChevronRight,
  Close,
  Time,
  Watson,
} from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { OAuthAppIcon } from "../../connections/components/oauth-app-icon.js";
import { CardIcon } from "../../settings/components/shared/card-icon.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type Section = "overview" | "sandbox-setup" | "skills" | "schedule" | "wikis";

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_SKILLS = [
  {
    id: "s1",
    name: "Code Search",
    description:
      "Search through code repositories and find relevant files, functions, and patterns",
    enabled: true,
  },
  {
    id: "s2",
    name: "File Editor",
    description:
      "Read, write, and modify files in the workspace with full filesystem access",
    enabled: true,
  },
  {
    id: "s3",
    name: "Terminal",
    description: "Execute shell commands, run scripts, and manage processes",
    enabled: true,
  },
  {
    id: "s4",
    name: "Web Browser",
    description:
      "Browse the web, fetch pages, and extract information from URLs",
    enabled: true,
  },
  {
    id: "s5",
    name: "UI Designer",
    description:
      "Generate and modify UI components, layouts, and design system elements",
    enabled: true,
  },
  {
    id: "s6",
    name: "Image Generation",
    description: "Create images from text descriptions using AI image models",
    enabled: false,
  },
  {
    id: "s7",
    name: "Data Analysis",
    description:
      "Analyze datasets, generate visualizations, and produce statistical summaries",
    enabled: false,
  },
  {
    id: "s8",
    name: "API Client",
    description: "Make HTTP requests to external APIs and process responses",
    enabled: true,
  },
  {
    id: "s9",
    name: "Git Operations",
    description:
      "Manage git repositories — commit, branch, merge, and review changes",
    enabled: true,
  },
  {
    id: "s10",
    name: "Package Manager",
    description: "Install, update, and manage project dependencies",
    enabled: true,
  },
  {
    id: "s11",
    name: "Docker",
    description: "Build, run, and manage container images and services",
    enabled: false,
  },
  {
    id: "s12",
    name: "Database Query",
    description: "Connect to databases and execute SQL queries",
    enabled: false,
  },
];

const MOCK_CONNECTIONS = [
  { id: "conn-1", templateId: "github", name: "jamies-github-test" },
  { id: "conn-2", templateId: "github", name: "jamies-ibm-github-connection" },
];

const MOCK_WIKIS = [
  { id: "w1", name: "Platform runbook", pages: 14, synced: true },
  { id: "w2", name: "Onboarding guide", pages: 8, synced: true },
  { id: "w3", name: "API reference", pages: 42, synced: false },
];

const MOCK_SCHEDULES = [
  {
    id: "sch-1",
    label: "Weekdays at 9:00 AM",
    cron: "0 9 * * 1-5",
    prompt:
      "Research and summarize the latest AI news, focusing on new model releases, regulatory changes, and open-source breakthroughs. Return a concise briefing.",
    enabled: true,
  },
  {
    id: "sch-2",
    label: "Every 6 hours",
    cron: "0 */6 * * *",
    prompt:
      "Check the CI pipeline status for all open PRs. If any are failing, summarize the errors and suggest fixes.",
    enabled: true,
  },
  {
    id: "sch-3",
    label: "Daily at midnight",
    cron: "0 0 * * *",
    prompt:
      "Run the full test suite and generate a coverage report. Flag any tests that have been flaky in the last week.",
    enabled: true,
  },
];

// ── Overview Cards (matching Figma) ──────────────────────────────────────────

function OverviewCards({ onNavigate }: { onNavigate: (s: Section) => void }) {
  const enabledSkills = MOCK_SKILLS.filter((s) => s.enabled);
  const visibleSkills = enabledSkills.slice(0, 3);
  const remainingCount = enabledSkills.length - visibleSkills.length;

  return (
    <div className="flex flex-col gap-2">
      {/* Sandbox Setup card */}
      <button
        type="button"
        onClick={() => onNavigate("sandbox-setup")}
        className="flex flex-col justify-center gap-1 rounded-lg border border-border bg-white/30 px-3 py-[7.5px] h-[86px] text-left hover:border-foreground/30 transition-colors group"
      >
        <div className="flex items-start justify-between w-full">
          <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-3">
            Sandbox setup
          </span>
          <ChevronRight size={16} className="text-muted-foreground shrink-0" />
        </div>
        <div className="pl-3">
          <span className="text-sm text-foreground">
            DAM Design helper, Claude code, 3 connections...
          </span>
        </div>
      </button>

      {/* Skills card */}
      <button
        type="button"
        onClick={() => onNavigate("skills")}
        className="flex flex-col justify-center gap-1 rounded-lg border border-border px-3 py-[7.5px] h-[86px] text-left hover:border-foreground/30 transition-colors group"
      >
        <div className="flex items-start justify-between w-full">
          <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-3">
            Skills
          </span>
          <ChevronRight size={16} className="text-muted-foreground shrink-0" />
        </div>
        <div className="flex flex-wrap gap-1 pl-3">
          {visibleSkills.map((skill) => (
            <span
              key={skill.id}
              className="border border-border rounded px-[13px] py-[2.875px] text-xs text-foreground capitalize leading-[15px] tracking-[0.34px]"
            >
              {skill.name}
            </span>
          ))}
          {remainingCount > 0 && (
            <span className="border border-border rounded px-[13px] py-[2.875px] text-xs text-foreground capitalize leading-[15px] tracking-[0.34px]">
              +{remainingCount}
            </span>
          )}
        </div>
      </button>

      {/* Schedule card */}
      <button
        type="button"
        onClick={() => onNavigate("schedule")}
        className="flex flex-col justify-center gap-1 rounded-lg border border-border px-3 py-[7.5px] h-[86px] text-left hover:border-foreground/30 transition-colors group"
      >
        <div className="flex items-start justify-between w-full">
          <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-3">
            Schedule
          </span>
          <ChevronRight size={16} className="text-muted-foreground shrink-0" />
        </div>
        <div className="pl-3">
          <span className="text-sm text-foreground">
            {MOCK_SCHEDULES.length} Schedules running
          </span>
        </div>
      </button>

      {/* Wikis card */}
      <button
        type="button"
        onClick={() => onNavigate("wikis")}
        className="flex flex-col justify-center gap-1 rounded-lg border border-border px-3 py-[7.5px] h-[86px] text-left hover:border-foreground/30 transition-colors group"
      >
        <div className="flex items-start justify-between w-full">
          <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-3">
            Wikis
          </span>
          <ChevronRight size={16} className="text-muted-foreground shrink-0" />
        </div>
        <div className="pl-3">
          <span className="text-sm text-foreground">
            {MOCK_WIKIS.filter((w) => w.synced).length > 0
              ? `${MOCK_WIKIS.filter((w) => w.synced).length} wikis connected`
              : "No wikis connected"}
          </span>
        </div>
      </button>
    </div>
  );
}

// ── Sandbox Setup Detail (matching Figma) ────────────────────────────────────

export function SandboxSetupDetail() {
  const [name, setName] = useState("DAM Design helper");
  const [image, setImage] = useState("claude-code");
  const [provider, setProvider] = useState("anthropic");
  const [networkOpen, setNetworkOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const setView = useStore((s) => s.setView);

  return (
    <div className="flex flex-col gap-8">
      {/* NAME */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-3">
          Name
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-10 rounded-lg border-border"
        />
      </div>

      {/* IMAGE */}
      <div className="flex flex-col gap-2">
        <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-3">
          Image
        </span>
        <Select value={image} onValueChange={setImage}>
          <SelectTrigger className="h-10 rounded-lg border-border">
            <div className="flex items-center gap-2">
              <CardIcon provider="anthropic" size="sm" />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude-code">Claude Code</SelectItem>
            <SelectItem value="codex">Codex</SelectItem>
            <SelectItem value="ibm-bob">IBM Bob</SelectItem>
            <SelectItem value="pi-agent">Pi Agent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* PROVIDER */}
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-3">
            Provider
          </span>
          <button
            type="button"
            onClick={() => setView("settings")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="text-muted-foreground"
            >
              <path
                d="M13.5 8.4c0 .3-.2.5-.5.5H8.4v4.6c0 .3-.2.5-.5.5s-.4-.2-.4-.5V8.9H3c-.3 0-.5-.2-.5-.5s.2-.4.5-.4h4.5V3.5c0-.3.2-.5.5-.5s.4.2.4.5V8h4.6c.3 0 .5.2.5.4z"
                fill="currentColor"
                opacity="0"
              />
              <path
                d="M6.6 2.3A5.8 5.8 0 0 1 8 2.1c3.2 0 5.9 2.6 5.9 5.9s-2.6 5.9-5.9 5.9-5.9-2.7-5.9-5.9c0-1 .3-2 .7-2.8M8 5.3v2.8m0 0H5.2m2.8 0h2.8"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="h-10 rounded-lg border-border">
            <div className="flex items-center gap-2">
              <CardIcon provider="anthropic" size="sm" />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="ibm-litellm">IBM watsonx</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="bob">BeeAI</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* MY CONNECTIONS */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between">
          <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-3">
            My Connections
          </span>
          <button
            type="button"
            onClick={() => setView("settings")}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="text-muted-foreground"
            >
              <path
                d="M6.6 2.3A5.8 5.8 0 0 1 8 2.1c3.2 0 5.9 2.6 5.9 5.9s-2.6 5.9-5.9 5.9-5.9-2.7-5.9-5.9c0-1 .3-2 .7-2.8M8 5.3v2.8m0 0H5.2m2.8 0h2.8"
                stroke="currentColor"
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            </svg>
          </button>
        </div>
        <div className="flex flex-col gap-3 pl-3">
          {MOCK_CONNECTIONS.map((c) => (
            <div key={c.id} className="flex items-start gap-2">
              <CheckboxCheckedFilled
                size={16}
                className="text-foreground shrink-0"
              />
              <OAuthAppIcon appId={c.templateId} alt={c.name} size={16} />
              <span className="text-sm text-muted-foreground">{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* NETWORK ACCESS */}
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => setNetworkOpen(!networkOpen)}
          className="flex items-center justify-between pl-3"
        >
          <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground">
            Network Access
          </span>
          <div className="p-1">
            <ChevronDown
              size={16}
              className={cn(
                "text-muted-foreground transition-transform",
                !networkOpen && "-rotate-90",
              )}
            />
          </div>
        </button>
        {networkOpen && (
          <div className="pl-3 pt-3 text-sm text-muted-foreground">
            Restricted · 3 allowed domains
          </div>
        )}
      </div>

      {/* ENVIRONMENT */}
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => setEnvOpen(!envOpen)}
          className="flex items-center justify-between pl-3"
        >
          <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground">
            Environment
          </span>
          <div className="p-1">
            <ChevronDown
              size={16}
              className={cn(
                "text-muted-foreground transition-transform",
                !envOpen && "-rotate-90",
              )}
            />
          </div>
        </button>
        {envOpen && (
          <div className="flex flex-col gap-1 pl-3 pt-3 text-xs font-mono text-muted-foreground">
            <span>NODE_ENV=development</span>
            <span>LOG_LEVEL=debug</span>
            <span>API_TIMEOUT=30000</span>
          </div>
        )}
      </div>

      {/* Submit button */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="rounded-md text-[13px] font-medium"
        >
          Submit changes
        </Button>
      </div>
    </div>
  );
}

// ── Skills Detail (#944 — installed vs available, upstream changes) ──────────

const AVAILABLE_SKILLS = [
  {
    id: "av-1",
    name: "Kubernetes",
    description:
      "Interact with K8s clusters — get pods, logs, deploy, rollback",
    source: "platform-official",
    hasUpdate: false,
  },
  {
    id: "av-2",
    name: "Slack Integration",
    description:
      "Send messages, read channels, manage threads in Slack workspaces",
    source: "community",
    hasUpdate: false,
  },
  {
    id: "av-3",
    name: "Jira",
    description: "Create, update, and query Jira issues and sprints",
    source: "community",
    hasUpdate: false,
  },
  {
    id: "av-4",
    name: "AWS CLI",
    description: "Execute AWS CLI commands with role-based access",
    source: "platform-official",
    hasUpdate: false,
  },
];

type SkillTab = "installed" | "available";

export function SkillsDetail() {
  const [skills, setSkills] = useState(MOCK_SKILLS);
  const [skillTab, setSkillTab] = useState<SkillTab>("installed");

  const toggle = (id: string) => {
    setSkills((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs: Installed / Available */}
      <div className="flex items-center gap-1 border-b border-border -mx-1">
        <button
          type="button"
          onClick={() => setSkillTab("installed")}
          className={cn(
            "px-3 py-2 text-[12px] font-medium border-b-2 transition-colors -mb-px",
            skillTab === "installed"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Installed
          <span className="ml-1.5 text-[10px] text-muted-foreground">
            ({skills.filter((s) => s.enabled).length})
          </span>
        </button>
        <button
          type="button"
          onClick={() => setSkillTab("available")}
          className={cn(
            "px-3 py-2 text-[12px] font-medium border-b-2 transition-colors -mb-px",
            skillTab === "available"
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          Available
          <span className="ml-1.5 text-[10px] text-muted-foreground">
            ({AVAILABLE_SKILLS.length})
          </span>
        </button>
      </div>

      {skillTab === "installed" && (
        <>
          <div className="flex flex-col gap-1.5">
            {skills.map((skill) => (
              <button
                key={skill.id}
                type="button"
                onClick={() => toggle(skill.id)}
                className={cn(
                  "flex items-start gap-3 px-3 py-3 rounded-lg text-left transition-colors",
                  skill.enabled
                    ? "hover:bg-muted/30"
                    : "opacity-60 hover:opacity-100 hover:bg-muted/20",
                )}
              >
                <CheckboxCheckedFilled
                  size={16}
                  className={cn(
                    "shrink-0 mt-0.5 transition-colors",
                    skill.enabled
                      ? "text-foreground"
                      : "text-muted-foreground/30",
                  )}
                />
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-sm font-medium",
                        skill.enabled
                          ? "text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {skill.name}
                    </span>
                    {/* Upstream update indicator for some skills */}
                    {(skill.id === "s4" || skill.id === "s9") && (
                      <span className="text-[9px] font-bold uppercase tracking-wide bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                        Update
                      </span>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground leading-snug">
                    {skill.description}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full rounded-lg text-[13px] font-medium gap-1.5"
          >
            <Add size={14} />
            Add skill source
          </Button>
        </>
      )}

      {skillTab === "available" && (
        <div className="flex flex-col gap-1.5">
          {AVAILABLE_SKILLS.map((skill) => (
            <div
              key={skill.id}
              className="flex items-start gap-3 px-3 py-3 rounded-lg text-left hover:bg-muted/30 transition-colors"
            >
              <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {skill.name}
                  </span>
                  <span className="text-[9px] font-medium text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                    {skill.source === "platform-official"
                      ? "Official"
                      : "Community"}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground leading-snug">
                  {skill.description}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-[11px] shrink-0"
              >
                Install
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Schedule Detail (#943 — run history, next/last run, status) ─────────────

interface ScheduleRun {
  id: string;
  timestamp: string;
  status: "success" | "failed" | "running";
  duration?: string;
}

const MOCK_SCHEDULE_RUNS: Record<string, ScheduleRun[]> = {
  "sch-1": [
    {
      id: "r1",
      timestamp: "2026-06-26T09:00:00Z",
      status: "success",
      duration: "2m 14s",
    },
    {
      id: "r2",
      timestamp: "2026-06-25T09:00:00Z",
      status: "success",
      duration: "1m 58s",
    },
    {
      id: "r3",
      timestamp: "2026-06-24T09:00:00Z",
      status: "failed",
      duration: "0m 32s",
    },
    {
      id: "r4",
      timestamp: "2026-06-23T09:00:00Z",
      status: "success",
      duration: "2m 05s",
    },
  ],
  "sch-2": [
    { id: "r5", timestamp: "2026-06-26T12:00:00Z", status: "running" },
    {
      id: "r6",
      timestamp: "2026-06-26T06:00:00Z",
      status: "success",
      duration: "4m 30s",
    },
    {
      id: "r7",
      timestamp: "2026-06-26T00:00:00Z",
      status: "success",
      duration: "3m 45s",
    },
  ],
  "sch-3": [
    {
      id: "r8",
      timestamp: "2026-06-26T00:00:00Z",
      status: "success",
      duration: "8m 12s",
    },
    {
      id: "r9",
      timestamp: "2026-06-25T00:00:00Z",
      status: "success",
      duration: "7m 55s",
    },
  ],
};

const MOCK_NEXT_RUNS: Record<string, string> = {
  "sch-1": "2026-06-27T09:00:00Z",
  "sch-2": "2026-06-26T18:00:00Z",
  "sch-3": "2026-06-27T00:00:00Z",
};

export function ScheduleDetail() {
  const [schedules, setSchedules] = useState(MOCK_SCHEDULES);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleSchedule = (id: string) => {
    setSchedules((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    );
  };

  const startEdit = (id: string, prompt: string) => {
    setEditingId(id);
    setEditPrompt(prompt);
  };

  const saveEdit = () => {
    if (!editingId) return;
    setSchedules((prev) =>
      prev.map((s) => (s.id === editingId ? { ...s, prompt: editPrompt } : s)),
    );
    setEditingId(null);
    setEditPrompt("");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-3">
          Scheduled Actions
        </span>
        <span className="text-xs text-muted-foreground">
          {schedules.filter((s) => s.enabled).length} running
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {schedules.map((schedule) => {
          const runs = MOCK_SCHEDULE_RUNS[schedule.id] ?? [];
          const lastRun = runs[0];
          const nextRun = MOCK_NEXT_RUNS[schedule.id];
          const isExpanded = expandedId === schedule.id;

          return (
            <div
              key={schedule.id}
              className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Time size={14} className="text-muted-foreground" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">
                      {schedule.label}
                    </span>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      {schedule.cron}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleSchedule(schedule.id)}
                  className={cn(
                    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0",
                    schedule.enabled
                      ? "bg-foreground"
                      : "bg-muted-foreground/30",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-3.5 w-3.5 transform rounded-full bg-background transition-transform",
                      schedule.enabled ? "translate-x-4.5" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>

              {/* Last run / next run summary */}
              <div className="flex items-center gap-3 pl-6 text-[11px]">
                {lastRun && (
                  <span className="flex items-center gap-1">
                    <span
                      className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        lastRun.status === "success"
                          ? "bg-success"
                          : lastRun.status === "running"
                            ? "bg-warning animate-pulse"
                            : "bg-destructive",
                      )}
                    />
                    <span className="text-muted-foreground">
                      Last:{" "}
                      {lastRun.status === "running"
                        ? "running now"
                        : lastRun.duration}
                    </span>
                  </span>
                )}
                {nextRun && schedule.enabled && (
                  <span className="text-muted-foreground">
                    Next:{" "}
                    {new Date(nextRun).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setExpandedId(isExpanded ? null : schedule.id)}
                  className="text-primary hover:underline ml-auto"
                >
                  {isExpanded ? "Hide history" : "History"}
                </button>
              </div>

              {/* Run history (expanded) */}
              {isExpanded && runs.length > 0 && (
                <div className="pl-6 mt-1 flex flex-col gap-1 border-t border-border/50 pt-2">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className="flex items-center gap-2 text-[11px]"
                    >
                      <span
                        className={cn(
                          "w-1.5 h-1.5 rounded-full shrink-0",
                          run.status === "success"
                            ? "bg-success"
                            : run.status === "running"
                              ? "bg-warning animate-pulse"
                              : "bg-destructive",
                        )}
                      />
                      <span className="text-muted-foreground w-[100px] shrink-0">
                        {new Date(run.timestamp).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}{" "}
                        {new Date(run.timestamp).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                      <span
                        className={cn(
                          "font-medium",
                          run.status === "success"
                            ? "text-success"
                            : run.status === "running"
                              ? "text-warning"
                              : "text-destructive",
                        )}
                      >
                        {run.status}
                      </span>
                      {run.duration && (
                        <span className="text-muted-foreground ml-auto">
                          {run.duration}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Prompt */}
              {editingId === schedule.id ? (
                <div className="flex flex-col gap-2 pl-6">
                  <textarea
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-xs text-foreground resize-none min-h-[60px] focus:outline-none focus:ring-1 focus:ring-primary"
                    rows={3}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setEditingId(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="text-xs h-7"
                      onClick={saveEdit}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => startEdit(schedule.id, schedule.prompt)}
                  className="pl-6 text-left group"
                >
                  <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2 group-hover:text-foreground transition-colors">
                    {schedule.prompt}
                  </p>
                  <span className="text-[10px] text-muted-foreground/60 group-hover:text-primary transition-colors">
                    Click to edit prompt
                  </span>
                </button>
              )}
            </div>
          );
        })}
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full rounded-lg text-[13px] font-medium gap-1.5"
      >
        <Add size={14} />
        Create new schedule
      </Button>
    </div>
  );
}

// ── Wikis Detail ─────────────────────────────────────────────────────────────

function WikisDetail() {
  const [wikis, setWikis] = useState(MOCK_WIKIS);

  const toggle = (id: string) => {
    setWikis((prev) =>
      prev.map((w) => (w.id === id ? { ...w, synced: !w.synced } : w)),
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-3">
          Connected Wikis
        </span>
        <span className="text-xs text-muted-foreground">
          {wikis.filter((w) => w.synced).length} synced
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {wikis.map((wiki) => (
          <div
            key={wiki.id}
            className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-3 transition-colors",
              wiki.synced
                ? "border-border"
                : "border-dashed border-muted-foreground/40",
            )}
          >
            <Watson size={16} className="text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-foreground truncate">
                {wiki.name}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {wiki.pages} pages
              </div>
            </div>
            <button
              type="button"
              onClick={() => toggle(wiki.id)}
              className={cn(
                "text-[11px] font-medium px-2.5 py-1 rounded transition-colors",
                wiki.synced
                  ? "text-emerald-600 bg-emerald-500/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/30",
              )}
            >
              {wiki.synced ? "Synced" : "Add"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

const SECTION_TITLES: Record<Section, string> = {
  overview: "Sandbox details",
  "sandbox-setup": "Sandbox setup",
  skills: "Skills",
  schedule: "Schedule",
  wikis: "Wikis",
};

export function NestedSetupPanel() {
  const setupPanelSection = useStore((s) => s.setupPanelSection);
  const [activeSection, setActiveSection] = useState<Section>(
    (setupPanelSection as Section) || "overview",
  );
  const toggleSetupPanel = useStore((s) => s.toggleSetupPanel);

  useEffect(() => {
    if (setupPanelSection) {
      setActiveSection(setupPanelSection as Section);
    }
  }, [setupPanelSection]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header with breadcrumb + close */}
      <div className="flex items-center justify-between px-4 py-4">
        <div className="flex items-center px-3">
          {activeSection === "overview" ? (
            <span className="text-base font-semibold text-foreground">
              Sandbox details
            </span>
          ) : (
            <span className="text-base leading-snug">
              <button
                type="button"
                onClick={() => setActiveSection("overview")}
                className="text-foreground hover:text-foreground/70 transition-colors"
              >
                Sandbox details
              </button>
              <span className="font-semibold text-foreground">
                {" "}
                / {SECTION_TITLES[activeSection]}
              </span>
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={toggleSetupPanel}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <Close size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4">
        {activeSection === "overview" && (
          <OverviewCards onNavigate={setActiveSection} />
        )}
        {activeSection === "sandbox-setup" && <SandboxSetupDetail />}
        {activeSection === "skills" && <SkillsDetail />}
        {activeSection === "schedule" && <ScheduleDetail />}
        {activeSection === "wikis" && <WikisDetail />}
      </div>
    </div>
  );
}
