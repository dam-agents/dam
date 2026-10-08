import {
  Add,
  ArrowRight,
  Chat,
  Close,
  ConnectionSignal,
  EventSchedule,
  Flash,
  Hashtag,
  SkillLevelAdvanced,
  Time,
} from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { AgentChrome } from "./chat-workspace-variants.js";

type FeaturePanel = "skills" | "schedules" | "connections" | "channels" | null;

function AgentLedHeader({
  chrome,
  featurePanel,
  setFeaturePanel,
  onConfigure,
}: {
  chrome: AgentChrome;
  featurePanel: FeaturePanel;
  setFeaturePanel: (p: FeaturePanel) => void;
  onConfigure?: () => void;
}) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
      {chrome.backButton}
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-full bg-success"
      />
      <span className="text-sm font-semibold text-foreground">
        {chrome.name}
      </span>
      <Badge variant="success" className="text-[14px]">
        Working
      </Badge>

      <div className="ml-auto flex items-center gap-1">
        <FeaturePill
          icon={<SkillLevelAdvanced size={16} />}
          label="2 skills"
          active={featurePanel === "skills"}
          onClick={() =>
            setFeaturePanel(featurePanel === "skills" ? null : "skills")
          }
        />
        <FeaturePill
          icon={<Time size={16} />}
          label="1 schedule"
          active={featurePanel === "schedules"}
          onClick={() =>
            setFeaturePanel(featurePanel === "schedules" ? null : "schedules")
          }
        />
        <FeaturePill
          icon={<ConnectionSignal size={16} />}
          label="1 connection"
          active={featurePanel === "connections"}
          onClick={() =>
            setFeaturePanel(
              featurePanel === "connections" ? null : "connections",
            )
          }
        />
        <span className="mx-1 h-4 w-px bg-border" />
        {chrome.menu}
      </div>
    </div>
  );
}

function FeaturePill({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 items-center gap-1.5 rounded-full px-2.5 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function FeatureSidePanel({
  panel,
  onClose,
  onConfigure,
}: {
  panel: FeaturePanel;
  onClose: () => void;
  onConfigure: (section: string) => void;
}) {
  if (!panel) return null;

  const content: Record<
    NonNullable<FeaturePanel>,
    { title: string; icon: ReactNode; body: ReactNode }
  > = {
    skills: {
      title: "Skills",
      icon: <SkillLevelAdvanced size={16} />,
      body: (
        <div className="flex flex-col gap-2">
          <FeatureCard
            name="Code Review"
            detail="Reviews PRs and suggests improvements"
            enabled
          />
          <FeatureCard
            name="Test Runner"
            detail="Runs test suites and reports failures"
            enabled
          />
          <button
            type="button"
            onClick={() => onConfigure("skills")}
            className="mt-1 flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Add size={16} /> Add skill
          </button>
        </div>
      ),
    },
    schedules: {
      title: "Schedules",
      icon: <Time size={16} />,
      body: (
        <div className="flex flex-col gap-2">
          <FeatureCard
            name="Daily standup summary"
            detail="Every weekday at 9:00 AM"
            enabled
          />
          <button
            type="button"
            onClick={() => onConfigure("schedules")}
            className="mt-1 flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Add size={16} /> Create schedule
          </button>
        </div>
      ),
    },
    connections: {
      title: "Connections",
      icon: <ConnectionSignal size={16} />,
      body: (
        <div className="flex flex-col gap-2">
          <FeatureCard name="GitHub" detail="dam-agents/dam" enabled />
          <p className="mt-2 px-3 text-sm text-muted-foreground">
            Each agent has its own connections. Adding GitHub here only grants
            this agent access.
          </p>
          <button
            type="button"
            onClick={() => onConfigure("connections")}
            className="mt-1 flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Add size={16} /> Add connection
          </button>
        </div>
      ),
    },
    channels: {
      title: "Channels",
      icon: <Hashtag size={16} />,
      body: (
        <div className="flex flex-col gap-2">
          <FeatureCard
            name="#engineering"
            detail="Slack · Anyone in this channel can use the agent"
            enabled
          />
          <p className="mt-2 px-3 text-sm text-muted-foreground">
            Sharing a channel gives everyone in it access to this agent.{" "}
            <span className="font-medium text-warning">
              Needs Sarah Miller's review.
            </span>
          </p>
          <button
            type="button"
            onClick={() => onConfigure("channels")}
            className="mt-1 flex h-9 items-center gap-2 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Add size={16} /> Add channel
          </button>
        </div>
      ),
    },
  };

  const c = content[panel];

  return (
    <div className="flex w-[320px] shrink-0 flex-col border-l border-border bg-background">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          {c.icon}
          {c.title}
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close panel"
          onClick={onClose}
        >
          <Close size={16} />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-4">{c.body}</div>
    </div>
  );
}

function FeatureCard({
  name,
  detail,
  enabled,
}: {
  name: string;
  detail: string;
  enabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{name}</p>
        <p className="truncate text-sm text-muted-foreground">{detail}</p>
      </div>
      {enabled && <span className="h-2 w-2 shrink-0 rounded-full bg-success" />}
    </div>
  );
}

function AgentLedEmptyState({
  agentName,
  onConfigure,
}: {
  agentName: string;
  onConfigure: (section: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8">
      <div className="w-full max-w-[560px]">
        <div className="mb-8 text-center">
          <h2 className="text-lg font-bold text-foreground">
            What should {agentName} work on?
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Send a message, or set up what this agent can do.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <CapabilityCard
            icon={<Chat size={20} />}
            title="Just chat"
            description="Ask a question or give a task"
            onClick={() => {}}
            accent={false}
          />
          <CapabilityCard
            icon={<ConnectionSignal size={20} />}
            title="Connect a service"
            description="GitHub, Slack, and more"
            onClick={() => onConfigure("connections")}
            accent={false}
          />
          <CapabilityCard
            icon={<EventSchedule size={20} />}
            title="Set a schedule"
            description="Automate recurring work"
            onClick={() => onConfigure("schedules")}
            accent={false}
          />
          <CapabilityCard
            icon={<SkillLevelAdvanced size={20} />}
            title="Add a skill"
            description="Teach it new abilities"
            onClick={() => onConfigure("skills")}
            accent={false}
          />
        </div>

        <div className="mt-8">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Try asking
          </p>
          <div className="flex flex-col gap-2">
            <SuggestedPrompt text="Review my latest PR and suggest improvements" />
            <SuggestedPrompt text="Run the test suite and fix any failures" />
            <SuggestedPrompt text="Summarize what changed in the repo this week" />
          </div>
        </div>
      </div>
    </div>
  );
}

function CapabilityCard({
  icon,
  title,
  description,
  onClick,
  accent,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  accent: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
        accent
          ? "border-accent bg-accent/5 hover:bg-accent/10"
          : "border-border hover:bg-muted",
      )}
    >
      <span className="text-muted-foreground">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}

function SuggestedPrompt({ text }: { text: string }) {
  return (
    <button
      type="button"
      className="flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-left text-sm text-foreground transition-colors hover:bg-muted"
    >
      <ArrowRight size={16} className="shrink-0 text-muted-foreground" />
      <span>{text}</span>
    </button>
  );
}

function NudgeBar({
  message,
  action,
  onAction,
  onDismiss,
}: {
  message: string;
  action: string;
  onAction: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mx-4 mb-2 flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/5 px-4 py-2.5 md:mx-8">
      <Flash size={16} className="shrink-0 text-accent" />
      <p className="flex-1 text-sm text-foreground">{message}</p>
      <Button variant="outline" size="sm" onClick={onAction}>
        {action}
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        onClick={onDismiss}
      >
        <Close size={16} />
      </Button>
    </div>
  );
}

export function AgentLedChatLayout({
  chrome,
  children,
  inputSlot,
  onConfigure,
  showEmpty,
  agentName,
}: {
  chrome: AgentChrome;
  children: ReactNode;
  inputSlot: ReactNode;
  onConfigure: (section: string) => void;
  showEmpty: boolean;
  agentName: string;
}) {
  const [featurePanel, setFeaturePanel] = useState<FeaturePanel>(null);
  const [nudgeDismissed, setNudgeDismissed] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <AgentLedHeader
        chrome={chrome}
        featurePanel={featurePanel}
        setFeaturePanel={setFeaturePanel}
        onConfigure={() => onConfigure("setup")}
      />
      <div className="flex flex-1 min-h-0">
        <div className="flex flex-1 flex-col min-w-0">
          {showEmpty ? (
            <AgentLedEmptyState
              agentName={agentName}
              onConfigure={onConfigure}
            />
          ) : (
            <div className="flex flex-1 flex-col min-h-0">{children}</div>
          )}
          <div className="shrink-0">{inputSlot}</div>
        </div>
        <FeatureSidePanel
          panel={featurePanel}
          onClose={() => setFeaturePanel(null)}
          onConfigure={onConfigure}
        />
      </div>
    </div>
  );
}
