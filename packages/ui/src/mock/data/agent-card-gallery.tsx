import { EdgeDevice, Time } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

import { emitToast } from "../../lib/toast.js";
import { AgentRow } from "../../modules/agents/components/agent-row.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import { ArtifactPreviewDialog } from "../../modules/artifacts/components/artifact-preview-dialog.js";
import { ConnectionIcon } from "../../modules/connections/components/connection-icon.js";
import { NotificationRow } from "../../modules/home/components/notification-row.js";
import { useStore } from "../../store.js";
import type { AgentView } from "../../types.js";
import {
  bareAgent,
  demoPackAgent,
  errorAgent,
  experimentAgent,
  fixtureSchedules,
  fullAgent,
  hibernatedUnknownSkills,
  knowledgeBaseAgent,
  neverHibernatesButHibernated,
  neverHibernatesOverBudget,
  packSkippedAgent,
  singularAgent,
} from "./agent-card-fixtures.js";
import { agents } from "./agents.js";

const running = agents.find((a) => a.state === "running")!;

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="border-t border-border pt-8">
      <p className="text-xl uppercase tracking-wide text-purple-600 dark:text-purple-400">
        {title}
      </p>
    </div>
  );
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[15px] font-medium text-purple-600/60 dark:text-purple-400/60">
      {children}
    </p>
  );
}

const noop = () => {};

function ChannelLogo({ src, alt }: { src: string; alt: string }) {
  return <img src={src} alt={alt} className="size-4" />;
}

const mockArtifacts: Record<string, LibraryArtifact> = {
  "art-coverage": {
    id: "art-coverage",
    title: "Test Coverage Report",
    slug: "coverage-report-v2.4",
    kind: "html",
    contentType: "text/html",
    fileName: "coverage-report-v2.4.html",
    sizeBytes: 48_200,
    version: 3,
    folderId: null,
    agentId: running.id,
    visibility: "private",
    expiresAt: null,
    viewCount: 12,
    shareUrl: null,
    createdAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    updatedAt: new Date(Date.now() - 45 * 60_000).toISOString(),
  },
  "art-bundle": {
    id: "art-bundle",
    title: "Release Bundle",
    slug: "release-v2.4-rc1",
    kind: "binary",
    contentType: "application/zip",
    fileName: "release-v2.4-rc1-artifacts-linux-amd64.zip",
    sizeBytes: 15_400_000,
    version: 1,
    folderId: null,
    agentId: running.id,
    visibility: "private",
    expiresAt: null,
    viewCount: 3,
    shareUrl: null,
    createdAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 30 * 60_000).toISOString(),
  },
  "art-adr": {
    id: "art-adr",
    title: "Architecture Decision Record",
    slug: "adr-017-event-sourcing",
    kind: "markdown",
    contentType: "text/markdown",
    fileName: "adr-017-event-sourcing.md",
    sizeBytes: 8_900,
    version: 2,
    folderId: null,
    agentId: running.id,
    visibility: "public",
    expiresAt: null,
    viewCount: 47,
    shareUrl: "https://example.com/share/adr-017",
    createdAt: new Date(Date.now() - 24 * 3_600_000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
  },
};

function NotificationRowSection() {
  const [previewArtifact, setPreviewArtifact] =
    useState<LibraryArtifact | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Agent (Chat)" />

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <StateLabel>Working</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="CI Pipeline Agent"
            action="Run integration test suite for v2.4 release"
            meta="12 min ago"
            working
            onOpen={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Unread</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="Bug Triage Agent"
            action="Triage and label open issues from last sprint"
            meta="30 min ago"
            unread
            onOpen={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Unread + Artifact</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="Build Agent"
            action="Build release v2.4-rc1 artifacts for all platforms"
            meta="30 min ago"
            unread
            artifact={{
              name: "release-v2.4-rc1-artifacts-linux-amd64.zip",
            }}
            onOpen={noop}
            onArtifactClick={() =>
              setPreviewArtifact(mockArtifacts["art-bundle"]!)
            }
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Read</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="Design Token Agent"
            action="Sync Figma variables to CSS custom properties"
            meta="2 hours ago"
            read
            onOpen={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Read + Artifact</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="CI Pipeline Agent"
            action="Run integration test suite for v2.4 release"
            meta="45 min ago"
            read
            artifact={{ name: "coverage-report-v2.4.html" }}
            onOpen={noop}
            onArtifactClick={() =>
              setPreviewArtifact(mockArtifacts["art-coverage"]!)
            }
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Hover — Working</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="CI Pipeline Agent"
            action="Run integration test suite for v2.4 release"
            meta="12 min ago"
            working
            forceHover
            onOpen={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Hover — Unread</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="Bug Triage Agent"
            action="Triage and label open issues from last sprint"
            meta="30 min ago"
            unread
            forceHover
            onOpen={noop}
            onDismiss={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Hover — Read</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="Design Token Agent"
            action="Sync Figma variables to CSS custom properties"
            meta="2 hours ago"
            read
            forceHover
            onOpen={noop}
            onDismiss={noop}
          />
        </div>
      </div>

      {/* ── Slack ─────────────────────────────────────────────────── */}
      <SectionHeader title="Slack" />

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <StateLabel>Working</StateLabel>
          <NotificationRow
            channelIcon={<ChannelLogo src="/icons/slack.svg" alt="Slack" />}
            channelKind="slack"
            agentName="Code Review Agent"
            action="Review PR #487 migrate user service to gRPC"
            channel="engineering"
            meta="4 min ago"
            working
            onOpen={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Unread</StateLabel>
          <NotificationRow
            channelIcon={<ChannelLogo src="/icons/slack.svg" alt="Slack" />}
            channelKind="slack"
            agentName="Code Review Agent"
            action="Review PR #347 auth middleware refactor"
            channel="pull-requests"
            meta="1 hour ago"
            unread
            onOpen={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Read + Artifact</StateLabel>
          <NotificationRow
            channelIcon={<ChannelLogo src="/icons/slack.svg" alt="Slack" />}
            channelKind="slack"
            agentName="Security Scanner"
            action="Run dependency audit and vulnerability scan"
            channel="security"
            meta="2 hours ago"
            read
            artifact={{ name: "adr-017-event-sourcing.md" }}
            onOpen={noop}
            onArtifactClick={() =>
              setPreviewArtifact(mockArtifacts["art-adr"]!)
            }
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Read</StateLabel>
          <NotificationRow
            channelIcon={<ChannelLogo src="/icons/slack.svg" alt="Slack" />}
            channelKind="slack"
            agentName="Code Review Agent"
            action="Review PR #347 auth middleware refactor"
            channel="pull-requests"
            meta="1 hour ago"
            read
            onOpen={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Hover — Unread</StateLabel>
          <NotificationRow
            channelIcon={<ChannelLogo src="/icons/slack.svg" alt="Slack" />}
            channelKind="slack"
            agentName="Code Review Agent"
            action="Review PR #347 auth middleware refactor"
            channel="pull-requests"
            meta="1 hour ago"
            unread
            forceHover
            onOpen={noop}
            onDismiss={noop}
          />
        </div>
      </div>

      {/* ── Schedule ──────────────────────────────────────────────── */}
      <SectionHeader title="Schedule" />

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <StateLabel>Unread</StateLabel>
          <NotificationRow
            channelIcon={<Time size={16} />}
            channelKind="schedule"
            agentName="Docs Sync Agent"
            action="Nightly API reference rebuild"
            meta="Scheduled 8:00 AM"
            onOpen={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Unread + Artifact</StateLabel>
          <NotificationRow
            channelIcon={<Time size={16} />}
            channelKind="schedule"
            agentName="Metrics Agent"
            action="Daily deployment metrics report"
            meta="Scheduled 8:00 AM"
            artifact={{ name: "deploy-metrics-sep-10.html" }}
            onOpen={noop}
            onArtifactClick={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Read</StateLabel>
          <NotificationRow
            channelIcon={<Time size={16} />}
            channelKind="schedule"
            agentName="Docs Sync Agent"
            action="Nightly API reference rebuild"
            meta="6 hours ago"
            read
            onOpen={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Hover — Read</StateLabel>
          <NotificationRow
            channelIcon={<Time size={16} />}
            channelKind="schedule"
            agentName="Docs Sync Agent"
            action="Nightly API reference rebuild"
            meta="6 hours ago"
            read
            forceHover
            onOpen={noop}
            onDismiss={noop}
          />
        </div>
      </div>

      {/* ── Telegram ──────────────────────────────────────────────── */}
      <SectionHeader title="Telegram" />

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <StateLabel>Unread</StateLabel>
          <NotificationRow
            channelIcon={
              <ChannelLogo src="/icons/telegram.svg" alt="Telegram" />
            }
            channelKind="telegram"
            agentName="PM Standup Bot"
            action="Generate daily standup summary for sprint 14"
            meta="2 hours ago"
            onOpen={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Read</StateLabel>
          <NotificationRow
            channelIcon={
              <ChannelLogo src="/icons/telegram.svg" alt="Telegram" />
            }
            channelKind="telegram"
            agentName="PM Standup Bot"
            action="Generate daily standup summary for sprint 14"
            meta="2 hours ago"
            read
            onOpen={noop}
          />
        </div>
      </div>

      {previewArtifact && (
        <ArtifactPreviewDialog
          artifact={previewArtifact}
          onClose={() => setPreviewArtifact(null)}
        />
      )}
    </div>
  );
}

interface CardDemoProps {
  title: string;
  note: string;
  agent: AgentView;
  temporaryDraw?: { count: number; cpuMilli: number; memoryMi: number };
}

function CardDemo({ title, note, agent, temporaryDraw }: CardDemoProps) {
  const display = resolveAgentDisplay(agent, new Set(), new Set());
  const scheduleCount = fixtureSchedules.filter(
    (s) => s.agentId === agent.id && s.enabled,
  ).length;

  return (
    <div>
      <div className="mb-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{note}</p>
      </div>
      <AgentRow
        agent={agent}
        display={display}
        temporaryDraw={temporaryDraw}
        deletePending={false}
        onSelect={noop}
        onConfigure={noop}
        configureLabel="Configure agent"
        onWake={noop}
        onRestart={noop}
        onPause={noop}
        onStop={noop}
        onDelete={noop}
        scheduleCount={scheduleCount || undefined}
      />
    </div>
  );
}

function ToastDemo() {
  const openApprovals = useStore((s) => s.openApprovals);
  const agentNames = [
    "CI Pipeline Agent",
    "Code Review Agent",
    "Security Scanner",
    "Build Agent",
    "Docs Sync Agent",
  ];

  const fireToast = () => {
    const name = agentNames[Math.floor(Math.random() * agentNames.length)]!;
    emitToast({
      kind: "warning",
      message: `${name} needs your approval`,
      ttl: 6000,
      action: {
        label: "Review",
        onClick: openApprovals,
      },
    });
  };

  return (
    <div className="flex items-center gap-3">
      <Button variant="outline" size="sm" onClick={fireToast}>
        Fire approval toast
      </Button>
      <span className="text-sm text-muted-foreground">
        Click to preview the toast notification
      </span>
    </div>
  );
}

export function AgentCardGallery() {
  document.title = "Notifications";
  return (
    <div>
      <PageHeader
        title="Production card designs"
        description="Every card state from prod rendered side by side. Review each one to decide what stays or changes."
      />

      <div className="mb-6">
        <ToastDemo />
      </div>

      <div className="flex flex-col gap-8">
        <NotificationRowSection />

        {/* ── Agent Cards (from remote) ──────────────────────────── */}
        <SectionHeader title="Agent Cards" />

        <CardDemo
          title="1. Full card"
          note="Slack channels, schedules, always-on, running."
          agent={fullAgent}
        />

        <CardDemo
          title="2. Bare card"
          note="Nothing attached. The metadata row should be absent."
          agent={bareAgent}
        />

        <CardDemo
          title="3. One-of-each"
          note="Singular forms: 1 channel, 1 schedule."
          agent={singularAgent}
        />

        <CardDemo
          title="4. Hibernated"
          note="Common real case: agent is hibernated."
          agent={hibernatedUnknownSkills}
        />

        <CardDemo
          title="5a. Always-on but currently hibernated"
          note="Never-hibernates but stopped — shows Idle (Always-on) badge."
          agent={neverHibernatesButHibernated}
        />

        <CardDemo
          title="5b. Always-on but over budget"
          note="Always-on badge only shows when running — this shows Over budget badge."
          agent={neverHibernatesOverBudget}
        />

        <CardDemo
          title="6. Knowledge base"
          note="Just an agent now — no special kind badge."
          agent={knowledgeBaseAgent}
        />

        <CardDemo
          title="7. Experiment"
          note="Just an agent now — no special kind badge."
          agent={experimentAgent}
        />

        <CardDemo
          title="8. Pack-created agent"
          note="No pack badge shown — pack is just a starting template."
          agent={packSkippedAgent}
        />

        <CardDemo
          title="9. Error state with contribution failures"
          note="Error badge, contribution failures badge, error status."
          agent={errorAgent}
        />

        <CardDemo
          title="10. Demo agent"
          note="Running agent created from a pack."
          agent={demoPackAgent}
        />

        {/* Overflow menu — static render for screenshot */}
        <div>
          <div className="mb-2">
            <p className="text-sm font-semibold text-foreground">
              11. Overflow menu
            </p>
            <p className="text-sm text-muted-foreground">
              Static render of the agent card dropdown menu.
            </p>
          </div>
          <div className="inline-flex min-w-[200px] flex-col rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              Configure agent
            </div>
            <div className="my-1 h-px bg-border" />
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              <ConnectionIcon iconSlug="slack" alt="" size={16} />
              Add to Slack channel
            </div>
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              <ConnectionIcon iconSlug="telegram" alt="" size={16} />
              Add to Telegram chat
            </div>
            <div className="my-1 h-px bg-border" />
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              Restart
            </div>
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              Pause — wakes on next use
            </div>
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm hover:bg-muted">
              Stop — until started again
            </div>
            <div className="my-1 h-px bg-border" />
            <div className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-3 text-sm text-danger hover:bg-danger-light">
              Delete agent
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
