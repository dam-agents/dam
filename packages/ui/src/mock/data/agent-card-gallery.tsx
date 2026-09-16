import { EdgeDevice, Time, Warning } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import { PageHeader } from "@/components/ui/page-header";

import { AgentRow } from "../../modules/agents/components/agent-row.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import { ArtifactPreviewDialog } from "../../modules/artifacts/components/artifact-preview-dialog.js";
import { ConnectionIcon } from "../../modules/connections/components/connection-icon.js";
import { NotificationRow } from "../../modules/home/components/notification-row.js";
import type { AgentView } from "../../types.js";
import {
  allFixtureAgents,
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
  temporaryDriverAgent,
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
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor"
            meta="12 min ago"
            working
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Unread</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor"
            meta="30 min ago"
            unread
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Unread + Artifact</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor"
            meta="30 min ago"
            unread
            artifact={{ name: "artifact-name.html" }}
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
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor"
            meta="2 hours ago"
            read
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Read + Artifact</StateLabel>
          <NotificationRow
            channelIcon={<EdgeDevice size={16} />}
            channelKind="agent"
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor"
            meta="45 min ago"
            read
            artifact={{ name: "artifact-name.html" }}
            onArtifactClick={() =>
              setPreviewArtifact(mockArtifacts["art-coverage"]!)
            }
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
            action="Review PR #487 session history refactor with long title to demonstrate truncation"
            channel="code-review"
            meta="4 min ago"
            working
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Unread</StateLabel>
          <NotificationRow
            channelIcon={<ChannelLogo src="/icons/slack.svg" alt="Slack" />}
            channelKind="slack"
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor with long title to demonstrate truncation"
            channel="code-review"
            meta="1 hour ago"
            unread
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Read + Artifact</StateLabel>
          <NotificationRow
            channelIcon={<ChannelLogo src="/icons/slack.svg" alt="Slack" />}
            channelKind="slack"
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor with long title to demonstrate truncation"
            channel="code-review"
            meta="2 hours ago"
            read
            artifact={{ name: "artifact-name.html" }}
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
            action="Review PR #487 session history refactor with long title to demonstrate truncation"
            channel="code-review"
            meta="1 hour ago"
            read
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
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor"
            meta="Scheduled 8:00 AM"
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Unread + Artifact</StateLabel>
          <NotificationRow
            channelIcon={<Time size={16} />}
            channelKind="schedule"
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor"
            meta="Scheduled 8:00 AM"
            artifact={{ name: "artifact-name.html" }}
            onArtifactClick={noop}
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Read</StateLabel>
          <NotificationRow
            channelIcon={<Time size={16} />}
            channelKind="schedule"
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor"
            meta="6 hours ago"
            read
          />
        </div>
      </div>

      {/* ── Telegram ──────────────────────────────────────────────── */}
      <SectionHeader title="Telegram" />

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <StateLabel>Read</StateLabel>
          <NotificationRow
            channelIcon={
              <ChannelLogo src="/icons/telegram.svg" alt="Telegram" />
            }
            channelKind="telegram"
            agentName="Code Review Agent"
            action="Review PR #487 session history refactor"
            meta="2 hours ago"
            read
          />
        </div>
      </div>

      {/* ── Approvals ────────────────────────────────────────────── */}
      <SectionHeader title="Approvals" />

      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <StateLabel>Pending (needs you)</StateLabel>
          <NotificationRow
            channelIcon={<Warning size={16} />}
            channelKind="approval"
            agentName="Code Review Agent"
            action="wants to run npm publish --access public"
            meta="2 min ago"
            unread
          />
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Allowed</StateLabel>
          <NotificationRow
            channelIcon={<Warning size={16} />}
            channelKind="approval"
            agentName="Code Review Agent"
            action="wants to run npm publish --access public"
            meta="15 min ago"
            read
          >
            <div className="mt-2">
              <span className="inline-flex items-center rounded-md bg-success/10 px-2.5 py-1 text-sm font-medium text-success">
                Allowed
              </span>
            </div>
          </NotificationRow>
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Allowed permanently</StateLabel>
          <NotificationRow
            channelIcon={<Warning size={16} />}
            channelKind="approval"
            agentName="Code Review Agent"
            action="wants to run npm publish --access public"
            meta="1 hour ago"
            read
          >
            <div className="mt-2">
              <span className="inline-flex items-center rounded-md bg-success/10 px-2.5 py-1 text-sm font-medium text-success">
                Allowed permanently
              </span>
            </div>
          </NotificationRow>
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Denied</StateLabel>
          <NotificationRow
            channelIcon={<Warning size={16} />}
            channelKind="approval"
            agentName="Code Review Agent"
            action="wants to run npm publish --access public"
            meta="30 min ago"
            read
          >
            <div className="mt-2">
              <span className="inline-flex items-center rounded-md bg-destructive/10 px-2.5 py-1 text-sm font-medium text-destructive">
                Denied
              </span>
            </div>
          </NotificationRow>
        </div>

        <div className="flex flex-col gap-3">
          <StateLabel>Denied permanently</StateLabel>
          <NotificationRow
            channelIcon={<Warning size={16} />}
            channelKind="approval"
            agentName="Code Review Agent"
            action="wants to run npm publish --access public"
            meta="2 hours ago"
            read
          >
            <div className="mt-2">
              <span className="inline-flex items-center rounded-md bg-destructive/10 px-2.5 py-1 text-sm font-medium text-destructive">
                Denied permanently
              </span>
            </div>
          </NotificationRow>
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


function CardDemo({
  agent,
  label,
  isDemo,
}: {
  agent: AgentView;
  label: string;
  isDemo?: boolean;
}) {
  const display = resolveAgentDisplay(agent, new Set(), new Set());
  const scheduleCount = fixtureSchedules.filter(
    (s) => s.agentId === agent.id,
  ).length;
  return (
    <div className="flex flex-col gap-3">
      <StateLabel>{label}</StateLabel>
      <AgentRow
        agent={agent}
        display={display}
        deletePending={false}
        isDemo={isDemo}
        onSelect={noop}
        onConfigure={noop}
        configureLabel="Configure"
        onWake={noop}
        onRestart={noop}
        onPause={noop}
        onStop={noop}
        onDelete={noop}
        scheduleCount={scheduleCount}
      />
    </div>
  );
}

function AgentCardSection() {
  return (
    <div className="flex flex-col gap-6">
      <SectionHeader title="Agent Cards" />

      <div className="flex flex-col gap-8">
        <CardDemo agent={fullAgent} label="§5-1 Full card — always-on, slack, schedules" />
        <CardDemo agent={bareAgent} label="§5-2 Bare card — nothing attached" />
        <CardDemo agent={singularAgent} label="§5-3 One-of-each — singular forms" />
        <CardDemo agent={hibernatedUnknownSkills} label="§5-4 Hibernated, unknown skills" />
        <CardDemo agent={neverHibernatesButHibernated} label="§5-5a Never-hibernates but stopped" />
        <CardDemo agent={neverHibernatesOverBudget} label="§5-5b Never-hibernates, over budget" />
        <CardDemo agent={knowledgeBaseAgent} label="§5-6 Knowledge base" />
        <CardDemo agent={experimentAgent} label="§5-7 Experiment" />
        <CardDemo agent={packSkippedAgent} label="§5-8 Pack applied, partly skipped" />
        <CardDemo agent={errorAgent} label="§5-9 Error state" />
        <CardDemo agent={temporaryDriverAgent} label="§5-10 Temporary-agent driver" />
        <CardDemo agent={demoPackAgent} label="§5-11 Demo pack agent" isDemo />
      </div>
    </div>
  );
}

export function AgentCardGallery() {
  document.title = "Card Gallery";
  return (
    <div>
      <PageHeader
        title="Production card designs"
        description="Every card state from prod rendered side by side. Review each one to decide what stays or changes."
      />

      <div className="flex flex-col gap-8">
        <NotificationRowSection />
        <AgentCardSection />
      </div>
    </div>
  );
}
