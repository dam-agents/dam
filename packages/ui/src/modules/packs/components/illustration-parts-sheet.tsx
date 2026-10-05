import {
  Box,
  Calendar,
  Checkmark,
  Globe,
  OverflowMenuVertical,
  Time,
  View,
} from "@carbon/icons-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { ConnectionIcon as SlackConnectionIcon } from "../../connections/components/connection-icon.js";

export function IllustrationPartsSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-background">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background px-8 py-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Illustration Parts
          </h1>
          <p className="text-sm text-muted-foreground">
            Components for empty-state collage diagrams. Capture to Figma and
            arrange freely.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Close sheet
        </button>
      </div>

      <div className="mx-auto max-w-[1400px] space-y-12 px-8 py-10">
        <PartGroup title="Schedule components">
          <ScheduleTile
            name="Daily PR review"
            cadence="Every day at 9:00 AM"
            enabled
          />
          <ScheduleTile
            name="Weekly docs audit"
            cadence="Every Monday at 8:00 AM"
            enabled
          />
          <ScheduleTile
            name="Nightly link scan"
            cadence="Every day at 6:00 AM"
            enabled={false}
          />
          <ScheduleMini label="9:00 AM daily" />
          <ScheduleMini label="Mon 8:00 AM" />
        </PartGroup>

        <PartGroup title="Slack messages">
          <SlackMessage
            author="Taylor"
            avatar="T"
            avatarColor="#4A154B"
            text="Hey, can someone review the auth PR? It's been open since Tuesday."
          />
          <SlackMessage
            author="Jordan"
            avatar="J"
            avatarColor="#1264A3"
            text="The staging deploy looks good — tests passed, no regressions."
          />
          <SlackMessage
            author="Agent"
            avatar="A"
            avatarColor="#2EB67D"
            isBot
            text="I reviewed PR #142 — found 2 issues in the error handling. Left comments on the diff."
          />
          <SlackMessage
            author="Agent"
            avatar="A"
            avatarColor="#2EB67D"
            isBot
            text="Docs audit complete. 3 pages updated, PR #87 opened. No broken links found."
          />
          <SlackMessage
            author="Riley"
            avatar="R"
            avatarColor="#E01E5A"
            text="What's the status of the API migration?"
          />
          <SlackMessage
            author="Agent"
            avatar="A"
            avatarColor="#2EB67D"
            isBot
            text="Meeting agenda for Monday standup has been posted to #team-meetings."
          />
        </PartGroup>

        <PartGroup title="Slack input bar">
          <SlackInputBar
            channel="#code-review"
            draft="Can you check the latest deploy?"
          />
          <SlackInputBar channel="#team-support" draft="" />
          <SlackInputBar
            channel="#docs-updates"
            draft="Update the API reference for v2.3"
          />
        </PartGroup>

        <PartGroup title="Slack elements">
          <SlackChannelBadge channel="#code-review" />
          <SlackChannelBadge channel="#team-meetings" />
          <SlackChannelBadge channel="#docs-updates" />
          <SlackChannelBadge channel="#team-support" />
          <SlackChannelBadge channel="#knowledge-base" />
          <div className="flex items-center gap-6">
            <SlackLogo size={48} />
            <SlackLogo size={32} />
            <SlackLogo size={24} />
          </div>
        </PartGroup>

        <PartGroup title="Platform chat messages">
          <PlatformChatUser text="Review the open PRs and nudge anyone who hasn't responded." />
          <PlatformChatUser text="Run the docs audit and fix what you find." />
          <PlatformChatAgent text="I found 3 stale PRs. Sent review reminders to the assigned reviewers in #code-review." />
          <PlatformChatAgent text="Docs audit complete. Updated 2 pages and opened PR #204 with the changes." />
        </PartGroup>

        <PartGroup title="GitHub elements">
          <GitHubPR
            number={142}
            title="Fix error handling in auth middleware"
            status="open"
            author="Taylor"
          />
          <GitHubPR
            number={87}
            title="Update API reference for v2.3"
            status="merged"
            author="Agent"
          />
          <GitHubPR
            number={204}
            title="Fix broken links in getting-started guide"
            status="open"
            author="Agent"
          />
          <GitHubCommit
            sha="a3f8c2d"
            message="Update changelog for release 2.3.0"
          />
          <GitHubCommit sha="7e1b9f4" message="Fix typo in README.md" />
        </PartGroup>

        <PartGroup title="Notification / status badges">
          <div className="flex flex-wrap items-center gap-3">
            <StatusPill label="2 PRs reviewed" variant="success" />
            <StatusPill label="3 stale PRs" variant="warning" />
            <StatusPill label="Build failed" variant="error" />
            <StatusPill label="Docs up to date" variant="success" />
            <StatusPill label="5 broken links" variant="warning" />
            <StatusPill label="Running..." variant="info" />
          </div>
        </PartGroup>

        <PartGroup title="Agent activity tiles">
          <AgentActivityTile
            action="Reviewed"
            target="PR #142"
            detail="Left 2 comments on error handling"
          />
          <AgentActivityTile
            action="Opened"
            target="PR #87"
            detail="Updated 3 docs pages for v2.3"
          />
          <AgentActivityTile
            action="Notified"
            target="#code-review"
            detail="Nudged 2 reviewers on stale PRs"
          />
          <AgentActivityTile
            action="Scanned"
            target="142 links"
            detail="Found 5 broken, fixed 3 automatically"
          />
        </PartGroup>

        <PartGroup title="Connection icons (larger, for collage)">
          <div className="flex flex-wrap items-center gap-6">
            <ConnectionIcon src="/icons/slack.svg" label="Slack" size={48} />
            <ConnectionIcon
              src="/icons/claude-code.svg"
              label="Claude Code"
              size={48}
            />
            <ConnectionIcon label="GitHub" size={48} github />
            <ConnectionIcon
              src="/icons/kubernetes.svg"
              label="Kubernetes"
              size={48}
            />
          </div>
        </PartGroup>

        <PartGroup title="Flow arrows & connectors">
          <div className="flex items-center gap-4">
            <FlowArrow direction="right" />
            <FlowArrow direction="down" />
            <FlowArrow direction="right" dashed />
            <FlowArrow direction="down" dashed />
          </div>
          <div className="flex items-center gap-3">
            <FlowDot color="var(--color-primary)" />
            <FlowLine />
            <FlowDot color="var(--c-cat-software)" />
            <FlowLine dashed />
            <FlowDot color="var(--c-cat-productivity)" />
          </div>
        </PartGroup>

        <PartGroup title="Mini file cards">
          <MiniFile name="CLAUDE.md" type="config" />
          <MiniFile name="Onboarding.md" type="guide" />
          <MiniFile name="changelog.md" type="output" />
          <MiniFile name=".github/workflows/ci.yml" type="config" />
        </PartGroup>

        <PartGroup title="Agent thinking / processing">
          <AgentThinking label="Reviewing PR diff..." />
          <AgentThinking label="Scanning 142 links..." />
          <AgentThinking label="Drafting meeting agenda..." />
        </PartGroup>

        <div className="border-t-2 border-dashed border-border pt-12" />

        <section>
          <h2 className="mb-2 text-lg font-bold text-foreground">
            Illustration 1 — Agents Page Empty State
          </h2>
          <p className="mb-8 text-sm text-muted-foreground">
            Floating collage: chat prompt → schedule card (hero) → agent working
            → Slack notification. Diagonal drift, overlap, one accent moment
            (busy dots).
          </p>
          <div className="relative h-[440px] w-[640px] overflow-hidden">
            <div
              className="absolute"
              style={{
                left: -40,
                top: 6,
                opacity: 0.5,
                transform: "scale(0.65)",
                transformOrigin: "top left",
                zIndex: 1,
              }}
            >
              <IllustrationAgentRow />
            </div>

            <div
              className="absolute"
              style={{
                left: 24,
                top: 32,
                opacity: 0.78,
                transform: "scale(0.92) rotate(-1.5deg)",
                transformOrigin: "top left",
                zIndex: 10,
              }}
            >
              <IllustrationUserBubble
                text={
                  <>
                    Every 10 minutes, check{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">
                      acme/payments-api
                    </code>{" "}
                    for issues labelled{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-[13px]">
                      ready
                    </code>{" "}
                    and open a PR.
                  </>
                }
              />
            </div>

            <div
              className="absolute"
              style={{
                left: 170,
                top: 145,
                zIndex: 30,
                boxShadow: "0 8px 30px -5px rgba(0,0,0,0.08)",
              }}
            >
              <IllustrationScheduleCard />
            </div>

            <div
              className="absolute flex flex-col gap-2"
              style={{
                left: 215,
                top: 270,
                opacity: 0.85,
                zIndex: 20,
              }}
            >
              <IllustrationBusyDots />
              <IllustrationActivityChip label="Opening pull request" />
            </div>

            <div
              className="absolute"
              style={{
                left: 285,
                top: 305,
                opacity: 0.7,
                transform: "scale(0.84) rotate(1.5deg)",
                transformOrigin: "top left",
                zIndex: 25,
              }}
            >
              <IllustrationSlackPost />
            </div>
          </div>
        </section>

        <div className="border-t-2 border-dashed border-border pt-12" />

        <section>
          <h2 className="mb-2 text-lg font-bold text-foreground">
            Illustration 2A — Artifacts (artifact row)
          </h2>
          <p className="mb-8 text-sm text-muted-foreground">
            Floating collage: chat prompt → agent working → artifact row →
            &ldquo;Link copied&rdquo; hero. Beat 3 is the full artifact row.
          </p>
          <div className="relative h-[440px] w-[640px] overflow-hidden">
            <div
              className="absolute"
              style={{
                left: 16,
                top: 24,
                opacity: 0.78,
                transform: "scale(0.92) rotate(-2deg)",
                transformOrigin: "top left",
                zIndex: 10,
              }}
            >
              <IllustrationUserBubble text="Write up the test results for #496 as a page I can send to the team." />
            </div>

            <div
              className="absolute flex flex-col gap-2"
              style={{
                left: 55,
                top: 155,
                opacity: 0.8,
                zIndex: 15,
              }}
            >
              <IllustrationBusyDots />
              <IllustrationActivityChip label="Writing test report" />
            </div>

            <div
              className="absolute"
              style={{
                left: 100,
                top: 225,
                opacity: 0.88,
                transform: "rotate(0.5deg)",
                transformOrigin: "top left",
                zIndex: 20,
              }}
            >
              <IllustrationArtifactRow
                kindLabel="MD"
                kindVariant="info"
                title="Test results — PR #496"
                agentName="payments-api-dev"
                timeAgo="2h ago"
                deletion="6d"
              />
            </div>

            <div
              className="absolute rounded-xl border border-border/50 bg-card px-4 py-3"
              style={{
                left: 290,
                top: 320,
                zIndex: 30,
                boxShadow: "0 8px 30px -5px rgba(0,0,0,0.08)",
              }}
            >
              <IllustrationCopiedLink />
            </div>
          </div>
        </section>

        <div className="border-t-2 border-dashed border-border pt-12" />

        <section>
          <h2 className="mb-2 text-lg font-bold text-foreground">
            Illustration 2B — Artifacts (ArtifactLinkChip)
          </h2>
          <p className="mb-8 text-sm text-muted-foreground">
            Same composition, beat 3 as inline ArtifactLinkChip instead of full
            row.
          </p>
          <div className="relative h-[440px] w-[640px] overflow-hidden">
            <div
              className="absolute"
              style={{
                left: 16,
                top: 24,
                opacity: 0.78,
                transform: "scale(0.92) rotate(-2deg)",
                transformOrigin: "top left",
                zIndex: 10,
              }}
            >
              <IllustrationUserBubble text="Write up the test results for #496 as a page I can send to the team." />
            </div>

            <div
              className="absolute flex flex-col gap-2"
              style={{
                left: 65,
                top: 155,
                opacity: 0.8,
                zIndex: 15,
              }}
            >
              <IllustrationBusyDots />
              <IllustrationActivityChip label="Writing test report" />
            </div>

            <div
              className="absolute"
              style={{
                left: 130,
                top: 240,
                opacity: 0.88,
                transform: "rotate(0.5deg)",
                transformOrigin: "top left",
                zIndex: 20,
              }}
            >
              <IllustrationArtifactChip
                kindLabel="MD"
                kindVariant="info"
                title="Test results — PR #496"
              />
            </div>

            <div
              className="absolute rounded-xl border border-border/50 bg-card px-4 py-3"
              style={{
                left: 250,
                top: 295,
                zIndex: 30,
                boxShadow: "0 8px 30px -5px rgba(0,0,0,0.08)",
              }}
            >
              <IllustrationCopiedLink />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function PartGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

function ScheduleTile({
  name,
  cadence,
  enabled,
}: {
  name: string;
  cadence: string;
  enabled: boolean;
}) {
  return (
    <div
      className={cn(
        CARD_SURFACE,
        "flex w-[280px] items-center gap-4 rounded-xl border border-border px-4 py-3",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-preset-border/50">
        <Time size={16} className="text-preset" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-foreground">
          {name}
        </p>
        <p className="truncate text-[14px] text-muted-foreground">{cadence}</p>
      </div>
      <div
        className={cn(
          "h-5 w-9 rounded-full",
          enabled ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <div
          className={cn(
            "mt-0.5 size-4 rounded-full bg-white shadow-sm transition-transform",
            enabled ? "translate-x-[18px]" : "translate-x-0.5",
          )}
        />
      </div>
    </div>
  );
}

function ScheduleMini({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5">
      <Time size={14} className="text-preset" />
      <span className="text-sm font-medium text-foreground">{label}</span>
    </div>
  );
}

function SlackMessage({
  author,
  avatar,
  avatarColor,
  text,
  isBot,
}: {
  author: string;
  avatar: string;
  avatarColor: string;
  text: React.ReactNode;
  isBot?: boolean;
}) {
  return (
    <div className="w-[380px] rounded-lg border border-border bg-white px-4 py-3 dark:bg-[#1a1d21]">
      <div className="flex items-start gap-2.5">
        <div
          className="flex size-8 shrink-0 items-center justify-center rounded text-sm font-bold text-white"
          style={{ background: avatarColor }}
        >
          {avatar}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[15px] font-bold text-foreground">
              {author}
            </span>
            {isBot && (
              <span className="rounded bg-muted-foreground/15 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                App
              </span>
            )}
            <span className="text-[14px] text-muted-foreground/60">
              10:32 AM
            </span>
          </div>
          <p className="mt-0.5 text-[15px] leading-relaxed text-foreground">
            {text}
          </p>
        </div>
      </div>
    </div>
  );
}

function SlackInputBar({ channel, draft }: { channel: string; draft: string }) {
  return (
    <div className="w-[380px] rounded-lg border border-[#868686]/40 bg-white px-4 py-3 dark:bg-[#1a1d21]">
      {draft ? (
        <p className="text-[15px] text-foreground">{draft}</p>
      ) : (
        <p className="text-[15px] text-muted-foreground/50">
          Message {channel}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between border-t border-border pt-2">
        <div className="flex gap-1.5">
          <SlackToolbarDot />
          <SlackToolbarDot />
          <SlackToolbarDot />
          <SlackToolbarDot />
        </div>
        <div
          className={cn(
            "flex size-7 items-center justify-center rounded",
            draft ? "bg-[#007a5a]" : "bg-muted-foreground/20",
          )}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            className={draft ? "text-white" : "text-muted-foreground/40"}
          >
            <path
              d="M1.5 8L14.5 1.5L8 14.5L6.5 9.5L1.5 8Z"
              fill="currentColor"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

function SlackToolbarDot() {
  return <div className="size-5 rounded bg-muted-foreground/10" />;
}

function SlackChannelBadge({ channel }: { channel: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-[#1264A3]/10 px-2 py-1 text-sm font-medium text-[#1264A3] dark:bg-[#1264A3]/20">
      <span className="text-[14px]">#</span>
      {channel.replace("#", "")}
    </span>
  );
}

function SlackLogo({ size = 32 }: { size?: number }) {
  return (
    <img
      src="/icons/slack.svg"
      alt="Slack"
      width={size}
      height={size}
      className="block"
    />
  );
}

function PlatformChatUser({ text }: { text: string }) {
  return (
    <div className="flex w-[380px] justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5">
        <p className="text-[15px] leading-relaxed text-primary-foreground">
          {text}
        </p>
      </div>
    </div>
  );
}

function PlatformChatAgent({ text }: { text: string }) {
  return (
    <div className="flex w-[380px] justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-border bg-card px-4 py-2.5">
        <p className="text-[15px] leading-relaxed text-foreground">{text}</p>
      </div>
    </div>
  );
}

function GitHubPR({
  number,
  title,
  status,
  author,
}: {
  number: number;
  title: string;
  status: "open" | "merged" | "closed";
  author: string;
}) {
  const statusColors = {
    open: "bg-[#238636] text-white",
    merged: "bg-[#8957e5] text-white",
    closed: "bg-[#da3633] text-white",
  };
  return (
    <div className="w-[340px] rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize",
            statusColors[status],
          )}
        >
          {status}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-medium text-foreground">
            {title} <span className="text-muted-foreground/60">#{number}</span>
          </p>
          <p className="mt-0.5 text-[14px] text-muted-foreground">
            opened by {author}
          </p>
        </div>
      </div>
    </div>
  );
}

function GitHubCommit({ sha, message }: { sha: string; message: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[14px] text-primary">
        {sha}
      </code>
      <span className="text-[14px] text-foreground">{message}</span>
    </div>
  );
}

function StatusPill({
  label,
  variant,
}: {
  label: string;
  variant: "success" | "warning" | "error" | "info";
}) {
  const styles = {
    success: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    warning: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    error: "bg-red-500/15 text-red-600 dark:text-red-400",
    info: "bg-blue-500/15 text-blue-600 dark:text-blue-400",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium",
        styles[variant],
      )}
    >
      {variant === "info" && (
        <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current" />
      )}
      {label}
    </span>
  );
}

function AgentActivityTile({
  action,
  target,
  detail,
}: {
  action: string;
  target: string;
  detail: string;
}) {
  return (
    <div className="w-[300px] rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-primary">{action}</span>
        <span className="text-sm font-medium text-foreground">{target}</span>
      </div>
      <p className="mt-1 text-[14px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function ConnectionIcon({
  src,
  label,
  size,
  github,
}: {
  src?: string;
  label: string;
  size: number;
  github?: boolean;
}) {
  if (github) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <div
          className="flex items-center justify-center rounded-xl border border-border bg-card"
          style={{ width: size + 16, height: size + 16 }}
        >
          <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            className="text-foreground"
          >
            <path
              fill="currentColor"
              d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
            />
          </svg>
        </div>
        <span className="text-[14px] text-muted-foreground">{label}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="flex items-center justify-center rounded-xl border border-border bg-card"
        style={{ width: size + 16, height: size + 16 }}
      >
        <img
          src={src}
          alt={label}
          width={size}
          height={size}
          className="block"
        />
      </div>
      <span className="text-[14px] text-muted-foreground">{label}</span>
    </div>
  );
}

function FlowArrow({
  direction,
  dashed,
}: {
  direction: "right" | "down";
  dashed?: boolean;
}) {
  const isRight = direction === "right";
  return (
    <svg
      width={isRight ? 60 : 24}
      height={isRight ? 24 : 60}
      viewBox={isRight ? "0 0 60 24" : "0 0 24 60"}
      fill="none"
      className="text-muted-foreground"
    >
      {isRight ? (
        <>
          <line
            x1="0"
            y1="12"
            x2="50"
            y2="12"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={dashed ? "4 3" : undefined}
          />
          <polygon points="50,6 60,12 50,18" fill="currentColor" />
        </>
      ) : (
        <>
          <line
            x1="12"
            y1="0"
            x2="12"
            y2="50"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray={dashed ? "4 3" : undefined}
          />
          <polygon points="6,50 12,60 18,50" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

function FlowDot({ color }: { color: string }) {
  return <div className="size-3 rounded-full" style={{ background: color }} />;
}

function FlowLine({ dashed }: { dashed?: boolean }) {
  return (
    <svg
      width="40"
      height="4"
      viewBox="0 0 40 4"
      className="text-muted-foreground"
    >
      <line
        x1="0"
        y1="2"
        x2="40"
        y2="2"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray={dashed ? "4 3" : undefined}
      />
    </svg>
  );
}

function MiniFile({
  name,
  type,
}: {
  name: string;
  type: "config" | "guide" | "output";
}) {
  const typeColors = {
    config: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
    guide: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    output: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  };
  return (
    <div className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      <span
        className={cn(
          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
          typeColors[type],
        )}
      >
        {type}
      </span>
      <code className="font-mono text-[14px] text-foreground">{name}</code>
    </div>
  );
}

function AgentThinking({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:0ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:150ms]" />
        <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:300ms]" />
      </div>
      <span className="text-[14px] text-muted-foreground">{label}</span>
    </div>
  );
}

function IllustrationUserBubble({ text }: { text: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-muted-foreground">You</span>
      <div className="max-w-[300px] rounded-xl border border-border bg-card px-4 py-3 text-sm leading-relaxed text-foreground">
        {text}
      </div>
    </div>
  );
}

function IllustrationBusyDots() {
  return (
    <span className="working-dots inline-flex items-center gap-[2px] text-accent">
      <span className="h-[5px] w-[5px] rounded-full bg-current" />
      <span className="h-[5px] w-[5px] rounded-full bg-current" />
      <span className="h-[5px] w-[5px] rounded-full bg-current" />
    </span>
  );
}

function IllustrationActivityChip({ label }: { label: string }) {
  return (
    <div className="border-l-2 border-border pl-3 text-sm text-muted-foreground">
      {label}
    </div>
  );
}

function IllustrationAgentRow() {
  return (
    <div className={cn(CARD_SURFACE, "w-full max-w-[600px]")}>
      <div className="flex items-start gap-4 p-5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate text-base font-semibold text-foreground">
              payments-api-dev
            </h2>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            2 CPU · 2 Gi
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="muted" className="gap-1.5">
              <SlackConnectionIcon iconSlug="slack" alt="" size={16} />
              #eng-payments
            </Badge>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="success">Working</Badge>
          <Button variant="ghost" size="icon" aria-label="Agent actions">
            <OverflowMenuVertical />
          </Button>
        </div>
      </div>
    </div>
  );
}

function IllustrationScheduleCard() {
  return (
    <div
      className={cn(
        CARD_SURFACE,
        "flex w-[340px] items-center gap-4 rounded-xl px-4 py-3",
      )}
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-100/50 text-accent dark:bg-blue-950/50">
        <Time size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-semibold text-foreground">
          software-developer-tick-10m
        </p>
        <p className="truncate text-[14px] text-muted-foreground">
          every 10 minutes · in 3 min
        </p>
      </div>
    </div>
  );
}

function IllustrationSlackPost() {
  return (
    <SlackMessage
      author="DAM"
      avatar="D"
      avatarColor="#2EB67D"
      isBot
      text={
        <>
          Opened{" "}
          <span className="font-semibold text-[#1264A3]">
            #496 Retry card declines with backoff
          </span>{" "}
          on acme/payments-api.
        </>
      }
    />
  );
}

function IllustrationArtifactRow({
  kindLabel,
  kindVariant,
  title,
  agentName,
  views,
  deletion,
  timeAgo,
  visibility,
}: {
  kindLabel: string;
  kindVariant: "accent" | "info" | "success" | "muted";
  title: string;
  agentName: string;
  views?: number;
  deletion?: string;
  timeAgo?: string;
  visibility?: "private" | "public";
}) {
  return (
    <div className="flex w-full min-w-[420px] items-center gap-3 rounded-xl border border-border px-4 py-2.5">
      <Badge
        size="sm"
        variant={kindVariant}
        className="min-w-[46px] justify-center tracking-wider"
      >
        {kindLabel}
      </Badge>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground">
          {title}
        </span>
        <span className="flex items-center gap-2.5 text-xs text-muted-foreground">
          <span className="inline-flex max-w-40 items-center gap-1 rounded-full bg-muted px-2 py-px">
            <Box size={12} className="shrink-0" />
            <span className="truncate">{agentName}</span>
          </span>
          {views != null && (
            <span className="inline-flex items-center gap-1">
              <View size={12} />
              {views}
            </span>
          )}
          {deletion != null && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap">
              <Calendar size={12} />
              {deletion}
            </span>
          )}
          {timeAgo && <span className="whitespace-nowrap">{timeAgo}</span>}
        </span>
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {visibility === "public" ? (
          <Badge variant="success" className="gap-1">
            <Globe size={12} />
            Public
          </Badge>
        ) : visibility === "private" ? (
          <Badge variant="muted">Private</Badge>
        ) : null}
      </div>
    </div>
  );
}

function IllustrationArtifactChip({
  kindLabel,
  kindVariant,
  title,
}: {
  kindLabel: string;
  kindVariant: "accent" | "info" | "success" | "muted";
  title: string;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-card px-2 py-0.5 text-sm font-medium text-foreground">
      <Badge
        size="sm"
        variant={kindVariant}
        className="min-w-[46px] justify-center tracking-wider"
      >
        {kindLabel}
      </Badge>
      <span className="truncate">{title}</span>
    </span>
  );
}

function IllustrationCopiedLink() {
  return (
    <div className="flex items-center gap-3">
      <Badge variant="success" className="gap-1">
        <Globe size={12} />
        Public
      </Badge>
      <span className="flex items-center gap-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
        <Checkmark size={14} />
        Link copied
      </span>
    </div>
  );
}
