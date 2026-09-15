import { EdgeDevice, Time } from "@carbon/icons-react";
import type { LibraryArtifact } from "api-server-api";
import { useState } from "react";

import { PageHeader } from "@/components/ui/page-header";

import { ArtifactPreviewDialog } from "../../modules/artifacts/components/artifact-preview-dialog.js";
import { NotificationRow } from "../../modules/home/components/notification-row.js";
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

export function AgentCardGallery() {
  document.title = "Notifications";
  return (
    <div>
      <PageHeader
        title="Production card designs"
        description="Every card state from prod rendered side by side. Review each one to decide what stays or changes."
      />

      <NotificationRowSection />
    </div>
  );
}
