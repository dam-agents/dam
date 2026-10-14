import {
  Add,
  ArrowLeft,
  ChevronRight,
  Close,
  ConnectionSignal,
  DataStructured,
  Document,
  Folder,
  OverflowMenuVertical,
  Pause,
  Renew,
  Search,
  SendAltFilled,
  Stop,
  Time,
} from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../store.js";

/* ─── Layout primitives ─── */

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mt-20 border-t-2 border-foreground/10 pt-10 text-xl font-bold tracking-tight text-foreground first:mt-0 first:border-t-0 first:pt-0">
      {children}
    </h2>
  );
}

function SectionNote({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 max-w-[960px] text-sm leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

function BoardRow({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 flex flex-wrap items-start gap-8">{children}</div>
  );
}

function Board({
  title,
  notes,
  width = 360,
  height,
  children,
}: {
  title: string;
  notes?: string[];
  width?: number;
  height?: number;
  children: ReactNode;
}) {
  return (
    <div style={{ width }}>
      <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>
      <div
        className="overflow-hidden rounded-lg border border-border bg-background"
        style={{ height }}
      >
        {children}
      </div>
      {notes && (
        <ul className="mt-2 flex flex-col gap-0.5 text-sm text-muted-foreground">
          {notes.map((n) => (
            <li key={n} className="flex gap-1.5">
              <span className="shrink-0 text-muted-foreground/60">·</span>
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Annotation({ children }: { children: ReactNode }) {
  return (
    <div className="mt-4 max-w-[560px] rounded-md bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

/* ─── Frozen: Plus Menu Root ─── */

function FrozenMenuRoot({ active }: { active?: string }) {
  const rows = [
    { label: "Attach file", badge: null },
    { label: "Skills", badge: "3 on" },
    { label: "Schedules", badge: "2 active" },
    { label: "Connections", badge: "4" },
  ];
  return (
    <div className="py-1">
      {rows.map((r) => (
        <button
          key={r.label}
          type="button"
          className={`flex w-full items-center gap-3 px-3 py-2.5 text-sm ${active === r.label ? "bg-muted" : ""}`}
        >
          <span className="flex-1 text-left text-foreground">{r.label}</span>
          {r.badge && (
            <span className="rounded-md bg-muted px-2 py-0.5 text-sm text-muted-foreground">
              {r.badge}
            </span>
          )}
          {r.label !== "Attach file" && (
            <ChevronRight size={16} className="text-muted-foreground" />
          )}
        </button>
      ))}
    </div>
  );
}

/* ─── Frozen: Panel Header ─── */

function FrozenPanelHeader({ title }: { title: string }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background px-3 py-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground">
        <ArrowLeft size={16} />
      </div>
      <span className="flex-1 text-sm font-semibold text-foreground">
        {title}
      </span>
      <span className="text-sm text-blue-500">Manage</span>
    </div>
  );
}

/* ─── Frozen: Panel Footer ─── */

function FrozenPanelFooter({
  addLabel,
  showDescribe,
}: {
  addLabel: string;
  showDescribe?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border bg-background px-3 py-2.5">
      <div className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground">
        <Add size={16} />
        {addLabel}
      </div>
      {showDescribe && (
        <span className="text-sm text-muted-foreground">
          Or, describe to create
        </span>
      )}
    </div>
  );
}

/* ─── Frozen: Skill Rows ─── */

function FrozenSkillRow({
  name,
  on,
  source,
  update,
}: {
  name: string;
  on: boolean;
  source?: boolean;
  update?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-2.5 first:border-t-0">
      <span className="flex-1 truncate text-[15px] font-medium text-foreground">
        {name}
      </span>
      {update && <span className="text-sm text-blue-500">Update</span>}
      {source && (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
          source
        </span>
      )}
      <div
        className={`h-5 w-9 rounded-full ${on ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <div
          className={`mt-0.5 h-4 w-4 rounded-full bg-white transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </div>
    </div>
  );
}

/* ─── Frozen: Schedule Row ─── */

function FrozenScheduleRow({
  name,
  cadence,
  enabled,
}: {
  name: string;
  cadence: string;
  enabled: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5">
      <div
        className={`flex h-8 w-8 items-center justify-center rounded-lg ${enabled ? "bg-blue-100/50 text-blue-600 dark:bg-blue-950/50" : "bg-muted text-muted-foreground"}`}
      >
        {enabled ? <Time size={16} /> : <Pause size={16} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{name}</p>
        <p className="truncate text-sm text-muted-foreground">{cadence}</p>
      </div>
      <div
        className={`h-5 w-9 rounded-full ${enabled ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <div
          className={`mt-0.5 h-4 w-4 rounded-full bg-white ${enabled ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </div>
      <OverflowMenuVertical size={16} className="text-muted-foreground" />
    </div>
  );
}

/* ─── Frozen: Connection Group ─── */

function FrozenConnectionGroup({
  provider,
  connections,
}: {
  provider: string;
  connections: { name: string; granted: boolean }[];
}) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex h-[52px] items-center gap-2.5 border-b border-border px-4">
        <ConnectionSignal size={16} className="text-foreground" />
        <span className="flex-1 text-[15px] font-semibold text-foreground">
          {provider}
        </span>
        <span className="text-sm text-muted-foreground">
          {connections.length} connections
        </span>
      </div>
      <div className="divide-y divide-border">
        {connections.map((c) => (
          <div key={c.name} className="flex items-center gap-2 px-4 py-3">
            <span className="flex-1 text-[15px] text-foreground">{c.name}</span>
            <div
              className={`h-5 w-9 rounded-full ${c.granted ? "bg-primary" : "bg-muted-foreground/30"}`}
            >
              <div
                className={`mt-0.5 h-4 w-4 rounded-full bg-white ${c.granted ? "translate-x-4" : "translate-x-0.5"}`}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Frozen: Input Bar ─── */

function FrozenInputBar({
  placeholder,
  value,
  computing,
  attachments,
  focused,
}: {
  placeholder?: string;
  value?: string;
  computing?: boolean;
  attachments?: { name: string; type: "image" | "file" }[];
  focused?: boolean;
}) {
  return (
    <div className="px-4 pt-3 pb-1">
      <div
        className={`flex flex-col rounded-xl border bg-background ${focused ? "border-primary" : "border-border"}`}
      >
        {attachments && attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a) =>
              a.type === "image" ? (
                <div
                  key={a.name}
                  className="relative h-14 w-14 rounded-md border border-border bg-muted"
                >
                  <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
                    <Close size={16} />
                  </div>
                </div>
              ) : (
                <div
                  key={a.name}
                  className="relative flex h-14 items-center gap-2 rounded-md border border-border bg-muted px-3"
                >
                  <Document size={16} className="text-foreground/80" />
                  <span className="max-w-[120px] truncate text-[11px] text-foreground/80">
                    {a.name}
                  </span>
                  <div className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
                    <Close size={16} />
                  </div>
                </div>
              ),
            )}
          </div>
        )}
        <div className="flex min-h-[56px] items-end gap-1 px-2">
          <div className="mb-[9px] flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground">
            <Add size={16} />
          </div>
          <div className="relative min-h-[56px] flex-1 py-[17px] text-sm leading-[22px]">
            {value ? (
              <span className="text-foreground">{value}</span>
            ) : (
              <span className="text-muted-foreground">
                {placeholder ?? "Message..."}
              </span>
            )}
          </div>
          {computing ? (
            <div className="mb-[9px] flex h-10 w-10 items-center justify-center rounded-md text-destructive">
              <Stop size={16} />
            </div>
          ) : (
            <div
              className={`mb-[9px] flex h-10 w-10 items-center justify-center rounded-md ${value ? "text-foreground" : "text-muted-foreground"}`}
            >
              <SendAltFilled size={16} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Frozen: Chat Header ─── */

function FrozenChatHeader({
  filesOpen,
  artifactsOpen,
}: {
  filesOpen?: boolean;
  artifactsOpen?: boolean;
}) {
  return (
    <div className="flex h-14 items-center gap-3 border-b border-border px-4">
      <div className="h-8 w-8 rounded-full bg-muted" />
      <span className="text-sm font-semibold text-foreground">ci-pipeline</span>
      <span className="h-2 w-2 rounded-full bg-emerald-500" />
      <div className="flex items-center gap-1 ml-2">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${filesOpen ? "bg-muted text-foreground" : "text-muted-foreground"}`}
        >
          <Folder size={16} />
        </div>
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${artifactsOpen ? "bg-muted text-foreground" : "text-muted-foreground"}`}
        >
          <DataStructured size={16} />
        </div>
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm text-foreground">
        <Add size={16} />
        New chat
      </div>
    </div>
  );
}

/* ─── Frozen: Left Docked Panel ─── */

function FrozenDockedPanel({
  type,
  items,
}: {
  type: "files" | "artifacts";
  items: string[];
}) {
  return (
    <div
      className="flex flex-col border-r border-border"
      style={{ width: 280 }}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-foreground">
          {type === "files" ? "Files" : "Artifacts"}
        </span>
        <Close size={16} className="text-muted-foreground" />
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            No {type} yet
          </p>
        ) : (
          <div className="py-1">
            {items.map((item) => (
              <div
                key={item}
                className="flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted"
              >
                {type === "files" ? (
                  <Document
                    size={16}
                    className="shrink-0 text-muted-foreground"
                  />
                ) : (
                  <DataStructured
                    size={16}
                    className="shrink-0 text-muted-foreground"
                  />
                )}
                <span className="truncate">{item}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Frozen: Configure Modal Shell ─── */

function FrozenConfigureModal({
  activeSection,
  showRestart,
}: {
  activeSection: string;
  showRestart?: boolean;
}) {
  const sections = [
    { label: "Agent Setup", summary: "2 CPU · 2 Gi" },
    { label: "Connections", summary: "4 granted" },
    { label: "Channels", summary: "—" },
    { label: "Skills", summary: "3 on" },
    { label: "Schedules", summary: "2 active" },
    { label: "Artifacts", summary: "—" },
    { label: "Usage", summary: "$12.40 this month" },
  ];
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <span className="text-sm font-semibold text-foreground">
          ci-pipeline
        </span>
        <Close size={16} className="text-muted-foreground" />
      </div>
      <div className="flex" style={{ height: 400 }}>
        <div className="flex w-[180px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2">
          {sections.map((s) => (
            <button
              key={s.label}
              type="button"
              className={`flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left ${activeSection === s.label ? "bg-muted" : ""}`}
            >
              <span className="text-sm font-medium text-foreground">
                {s.label}
              </span>
              <span className="truncate text-[13px] text-muted-foreground">
                {s.summary}
              </span>
            </button>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {activeSection === "Agent Setup" && (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">CPU</p>
                  <div className="mt-2 h-2 rounded-full bg-muted">
                    <div className="h-2 w-1/3 rounded-full bg-primary" />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">2 CPU</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Memory</p>
                  <div className="mt-2 h-2 rounded-full bg-muted">
                    <div className="h-2 w-1/3 rounded-full bg-primary" />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">2 Gi</p>
                </div>
                {showRestart && (
                  <p className="text-sm text-muted-foreground">
                    Changing the size restarts the agent on save.
                  </p>
                )}
              </div>
            )}
            {activeSection === "Skills" && (
              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-muted-foreground">
                  Created in this agent
                </p>
                <div className="rounded-lg border border-border">
                  <FrozenSkillRow name="code-review" on />
                  <FrozenSkillRow name="pr-summary" on />
                </div>
                <p className="mt-4 text-sm font-medium text-muted-foreground">
                  Included with sandbox image
                </p>
                <div className="rounded-lg border border-border">
                  <FrozenSkillRow name="file-search" on />
                </div>
              </div>
            )}
          </div>
          {showRestart && (
            <div className="flex items-center gap-3 border-t border-border px-5 py-3">
              <div className="mr-auto flex items-center gap-2 text-sm text-warning">
                <Renew size={16} />
                Saving will restart the agent to apply its new size.
              </div>
              <div className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Save &amp; restart
              </div>
            </div>
          )}
          {!showRestart && (
            <div className="flex items-center justify-end border-t border-border px-5 py-3">
              <div className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Submit changes
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Frozen: Empty State ─── */

function FrozenEmptyDashed({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-4 py-6 text-center">
      <Document size={16} className="text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/* ─── Frozen: Placeholder Text Rotation ─── */

function FrozenPlaceholderExample({ text }: { text: string }) {
  return (
    <div className="flex items-end gap-1 px-2 min-h-[56px]">
      <div className="mb-[9px] flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted-foreground">
        <Add size={16} />
      </div>
      <div className="relative min-h-[56px] flex-1 py-[17px]">
        <span className="text-sm text-muted-foreground">{text}</span>
        <span className="ml-2 inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">
          Tab
        </span>
      </div>
      <div className="mb-[9px] flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground">
        <SendAltFilled size={16} />
      </div>
    </div>
  );
}

/* ─── Main Component ─── */

export function HandoffSheet() {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => useStore.setState({ view: "chat" })}
          aria-label="Back to chat"
        >
          <ArrowLeft size={16} />
        </Button>
        <h1 className="text-base font-semibold text-foreground">
          Handoff Sheet
        </h1>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-8 pb-24">
        <div className="max-w-[1400px]">
          {/* ─── 1. Plus Menu ─── */}
          <SectionTitle>Plus Menu</SectionTitle>
          <SectionNote>
            Opened from the + button in the input bar. Root menu slides left to
            reveal sub-panels (150ms ease-in-out translateX).
          </SectionNote>

          <BoardRow>
            <Board
              title="Root menu"
              width={360}
              notes={[
                "Popover: side=top, align=start",
                "360px wide, max 60vh tall",
                "Badge shows count per section",
              ]}
            >
              <FrozenMenuRoot />
            </Board>

            <Board
              title="Root → hover Skills"
              width={360}
              notes={["Row highlights on hover", "Chevron indicates sub-panel"]}
            >
              <FrozenMenuRoot active="Skills" />
            </Board>
          </BoardRow>

          {/* ─── 2. Skills ─── */}
          <SectionTitle>Skills Panel</SectionTitle>
          <SectionNote>
            Slides in from the plus menu. Shows skills grouped by source with
            on/off toggles.
          </SectionNote>

          <BoardRow>
            <Board
              title="Skills — populated"
              width={360}
              notes={[
                "Header: back arrow + title + Manage link",
                "Skills grouped by source with toggles",
                "Footer: Add source + Or, describe to create",
              ]}
            >
              <FrozenPanelHeader title="Skills" />
              <div className="px-2 py-2">
                <p className="px-2 pb-1 text-[13px] text-muted-foreground">
                  Created in this agent
                </p>
                <div className="rounded-lg border border-border">
                  <FrozenSkillRow name="code-review" on />
                  <FrozenSkillRow name="pr-summary" on />
                  <FrozenSkillRow name="deploy-check" on={false} />
                </div>
                <p className="mt-3 px-2 pb-1 text-[13px] text-muted-foreground">
                  acme/platform-skills
                </p>
                <div className="rounded-lg border border-border">
                  <FrozenSkillRow name="lint-fix" on source />
                  <FrozenSkillRow name="test-gen" on={false} source update />
                </div>
              </div>
              <FrozenPanelFooter addLabel="Add source" showDescribe />
            </Board>

            <Board
              title="Skills — empty"
              width={360}
              notes={[
                "Dashed border drop zone",
                "Accepts .md file drag-and-drop",
              ]}
            >
              <FrozenPanelHeader title="Skills" />
              <div className="px-3 py-4">
                <FrozenEmptyDashed text="Drop a .md file here, add a source, or describe what you need below" />
              </div>
              <FrozenPanelFooter addLabel="Add source" showDescribe />
            </Board>

            <Board
              title="Skill with drift"
              width={360}
              notes={[
                '"Update" link when upstream changed',
                "Click name opens preview modal",
              ]}
            >
              <FrozenPanelHeader title="Skills" />
              <div className="px-2 py-2">
                <div className="rounded-lg border border-border">
                  <FrozenSkillRow name="code-review" on />
                  <FrozenSkillRow name="lint-fix" on source update />
                  <FrozenSkillRow name="test-gen" on source />
                </div>
              </div>
            </Board>
          </BoardRow>

          {/* ─── 3. Schedules ─── */}
          <SectionTitle>Schedules Panel</SectionTitle>
          <SectionNote>
            Shows agent schedules with enable/disable toggles and cadence info.
          </SectionNote>

          <BoardRow>
            <Board
              title="Schedules — populated"
              width={360}
              notes={[
                "Blue icon = enabled, gray = disabled",
                "Search appears when > 6 schedules",
                "Toggle emits toast confirmation",
              ]}
            >
              <FrozenPanelHeader title="Schedules" />
              <div className="flex flex-col gap-1.5 px-2 py-2">
                <div className="rounded-lg border border-border">
                  <FrozenScheduleRow
                    name="Daily standup digest"
                    cadence="Weekdays at 9am · Next in 14h"
                    enabled
                  />
                </div>
                <div className="rounded-lg border border-border">
                  <FrozenScheduleRow
                    name="Weekly bug triage"
                    cadence="Fridays at 2pm · Next in 3d"
                    enabled
                  />
                </div>
                <div className="rounded-lg border border-border">
                  <FrozenScheduleRow
                    name="Nightly test run"
                    cadence="Every day at 11pm · Paused"
                    enabled={false}
                  />
                </div>
              </div>
              <FrozenPanelFooter addLabel="Add schedule" showDescribe />
            </Board>

            <Board
              title="Schedules — empty"
              width={360}
              notes={['"Describe it" prefills input bar']}
            >
              <FrozenPanelHeader title="Schedules" />
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <p className="text-sm font-medium text-foreground">
                  No schedules yet
                </p>
                <p className="text-sm text-muted-foreground">
                  Describe what you need and the agent will set one up
                </p>
                <div className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm text-foreground">
                  Describe it
                </div>
              </div>
              <FrozenPanelFooter addLabel="Add schedule" showDescribe />
            </Board>

            <Board
              title="Schedules — with search"
              width={360}
              notes={[
                "Search input appears when > 6 items",
                'No match: "No schedules match {query}"',
              ]}
            >
              <FrozenPanelHeader title="Schedules" />
              <div className="px-3 py-2">
                <div className="relative">
                  <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  />
                  <div className="h-9 rounded-md border border-border bg-background pl-9 pr-3 text-sm leading-9 text-muted-foreground">
                    Search schedules...
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 px-2 py-1">
                <div className="rounded-lg border border-border">
                  <FrozenScheduleRow
                    name="Daily standup digest"
                    cadence="Weekdays at 9am"
                    enabled
                  />
                </div>
              </div>
            </Board>
          </BoardRow>

          {/* ─── 4. Connections ─── */}
          <SectionTitle>Connections Panel</SectionTitle>
          <SectionNote>
            Grouped by provider. Badge turns red if any connection is expired or
            disconnected.
          </SectionNote>

          <BoardRow>
            <Board
              title="Connections — populated"
              width={360}
              notes={[
                "Grouped by provider with grant/revoke toggles",
                "Search appears when > 6 connections",
              ]}
            >
              <FrozenPanelHeader title="Connections" />
              <div className="flex flex-col gap-3 px-2 py-2">
                <FrozenConnectionGroup
                  provider="GitHub"
                  connections={[
                    { name: "acme/platform", granted: true },
                    { name: "acme/docs", granted: true },
                  ]}
                />
                <FrozenConnectionGroup
                  provider="Slack"
                  connections={[
                    { name: "#team-dev", granted: true },
                    { name: "#alerts", granted: false },
                  ]}
                />
              </div>
              <FrozenPanelFooter addLabel="Add connection" />
            </Board>

            <Board
              title="Connections — empty"
              width={360}
              notes={['"Add connection" opens catalog modal']}
            >
              <FrozenPanelHeader title="Connections" />
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  No connections configured
                </p>
                <div className="mt-1 rounded-md border border-border px-3 py-1.5 text-sm text-foreground">
                  Add connection
                </div>
              </div>
            </Board>

            <Board
              title="Connections — loading"
              width={360}
              notes={["3 skeleton rows with pulse animation"]}
            >
              <FrozenPanelHeader title="Connections" />
              <div className="flex flex-col gap-3 px-2 py-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-lg bg-muted"
                  />
                ))}
              </div>
            </Board>
          </BoardRow>

          {/* ─── 5. File + Artifact Panels ─── */}
          <SectionTitle>Artifact + File Panels</SectionTitle>
          <SectionNote>
            Left-docked panels (280px). Both can be open simultaneously, stacked
            vertically.
          </SectionNote>

          <BoardRow>
            <Board
              title="Files panel open"
              width={600}
              height={400}
              notes={[
                "Toggle via Folder icon in chat header",
                "280px panel slides open (200ms ease)",
                "Panel has close X + scrollable content",
              ]}
            >
              <FrozenChatHeader filesOpen artifactsOpen={false} />
              <div className="flex" style={{ height: 346 }}>
                <FrozenDockedPanel
                  type="files"
                  items={[
                    "src/",
                    "  index.ts",
                    "  auth.ts",
                    "  config.ts",
                    "README.md",
                    "package.json",
                  ]}
                />
                <div className="flex-1 bg-background" />
              </div>
            </Board>

            <Board
              title="Both panels open"
              width={600}
              height={400}
              notes={[
                "Both stack vertically in same 280px column",
                "Each independently scrollable",
                "Divider border between panels",
              ]}
            >
              <FrozenChatHeader filesOpen artifactsOpen />
              <div className="flex" style={{ height: 346 }}>
                <div
                  className="flex flex-col border-r border-border"
                  style={{ width: 280 }}
                >
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="text-sm font-medium text-foreground">
                      Files
                    </span>
                    <Close size={16} className="text-muted-foreground" />
                  </div>
                  <div className="flex-1 overflow-y-auto border-b border-border">
                    {["src/", "  index.ts", "  auth.ts"].map((f) => (
                      <div
                        key={f}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-foreground"
                      >
                        <Document
                          size={16}
                          className="shrink-0 text-muted-foreground"
                        />
                        {f}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between border-b border-border px-3 py-2">
                    <span className="text-sm font-medium text-foreground">
                      Artifacts
                    </span>
                    <Close size={16} className="text-muted-foreground" />
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    {["Analysis report", "Architecture diagram"].map((a) => (
                      <div
                        key={a}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm text-foreground"
                      >
                        <DataStructured
                          size={16}
                          className="shrink-0 text-muted-foreground"
                        />
                        {a}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex-1 bg-background" />
              </div>
            </Board>
          </BoardRow>

          <BoardRow>
            <Board
              title="Files — empty"
              width={600}
              height={300}
              notes={['Shows "No files yet" centered message']}
            >
              <FrozenChatHeader filesOpen artifactsOpen={false} />
              <div className="flex" style={{ height: 246 }}>
                <FrozenDockedPanel type="files" items={[]} />
                <div className="flex-1 bg-background" />
              </div>
            </Board>

            <Board
              title="Panels closed"
              width={600}
              height={300}
              notes={[
                "Both toggle buttons inactive (text-muted-foreground)",
                "Panel width animates to 0",
              ]}
            >
              <FrozenChatHeader filesOpen={false} artifactsOpen={false} />
              <div className="flex-1 bg-background" style={{ height: 246 }} />
            </Board>
          </BoardRow>

          {/* ─── 6. Input Bar ─── */}
          <SectionTitle>Input Bar</SectionTitle>
          <SectionNote>
            Primary interaction surface. Supports text input, file attachments,
            rotating placeholder hints, and prefill from panels.
          </SectionNote>

          <BoardRow>
            <Board
              title="Idle — with placeholder"
              width={500}
              notes={[
                "Placeholder text rotates every 6s (400ms fade)",
                "Tab key fills current suggestion",
                "Tab badge shown next to text",
              ]}
            >
              <div className="rounded-xl border border-border">
                <FrozenPlaceholderExample text="Every Friday, file GitHub issues for usability problems raised in #team-help" />
              </div>
            </Board>

            <Board
              title="Focused — with text"
              width={500}
              notes={[
                "Border changes to border-primary on focus",
                "Send button activates (text-foreground)",
                "Enter sends, Shift+Enter newline",
              ]}
            >
              <FrozenInputBar
                value="Review the latest PR and check for security issues"
                focused
              />
            </Board>
          </BoardRow>

          <BoardRow>
            <Board
              title="Computing — stop button"
              width={500}
              notes={[
                'Placeholder: "Queue a message..."',
                "Stop button (danger) replaces send",
                "Sent messages queue until agent is free",
              ]}
            >
              <FrozenInputBar placeholder="Queue a message..." computing />
            </Board>

            <Board
              title="With attachments"
              width={500}
              notes={[
                "Images: 56px thumbnail with red X remove",
                "Files: filename pill with Document icon",
                "Via paste, drag-drop, or Attach file menu",
              ]}
            >
              <FrozenInputBar
                placeholder="Message..."
                attachments={[
                  { name: "screenshot.png", type: "image" },
                  { name: "requirements.pdf", type: "file" },
                ]}
              />
            </Board>
          </BoardRow>

          <Annotation>
            All 7 placeholder texts rotate: Schedules, Skills, Slack, Artifacts,
            Code, Connections, Memory. &ldquo;Describe to create&rdquo; in
            skills/schedules panels prefills the input and focuses it.
          </Annotation>

          {/* ─── 7. Configure Modal ─── */}
          <SectionTitle>Configure Modal</SectionTitle>
          <SectionNote>
            960px modal with 220px left nav. Opened from chat header (agent
            name) or &ldquo;Manage&rdquo; links in sub-panels.
          </SectionNote>

          <BoardRow>
            <Board
              title="Agent Setup — at rest"
              width={700}
              notes={[
                "7 nav sections with summary text",
                "Active section highlighted bg-muted",
                "Right content scrollable (max 70vh)",
              ]}
            >
              <FrozenConfigureModal activeSection="Agent Setup" />
            </Board>

            <Board
              title="Agent Setup — restart warning"
              width={700}
              notes={[
                "Shown when CPU/memory changed on running agent",
                'Footer: Renew icon + warning + "Save & restart"',
                "Confirmation dialog before applying",
              ]}
            >
              <FrozenConfigureModal activeSection="Agent Setup" showRestart />
            </Board>
          </BoardRow>

          <BoardRow>
            <Board
              title="Skills section"
              width={700}
              notes={[
                "Same modal, Skills nav selected",
                'Groups: "Created in this agent" + sources + built-in',
                "Opened via Manage link in skills popover",
              ]}
            >
              <FrozenConfigureModal activeSection="Skills" />
            </Board>
          </BoardRow>

          {/* ─── 8. New Chat ─── */}
          <SectionTitle>New Chat</SectionTitle>
          <SectionNote>
            Session is not created until first message is sent. Textarea
            auto-focuses on next animation frame.
          </SectionNote>

          <BoardRow>
            <Board
              title="Empty state (mock)"
              width={600}
              height={350}
              notes={[
                "No visible prompt — rotating placeholders guide the user",
                '"New chat" button in header (mock mode only)',
                "resetSession() clears state, defers session creation",
              ]}
            >
              <FrozenChatHeader filesOpen={false} artifactsOpen={false} />
              <div
                className="flex flex-1 items-center justify-center"
                style={{ height: 240 }}
              >
                <div className="text-sm text-muted-foreground/50" />
              </div>
              <FrozenInputBar placeholder="Every Friday, file GitHub issues for usability problems raised in #team-help" />
            </Board>

            <Board
              title="Empty state (production)"
              width={600}
              height={350}
              notes={[
                "Heading + launcher tile grid (2 columns)",
                "Tiles: Browser Terminal, Local Terminal, VS Code/Zed, Slack",
                "Each tile: icon + title + description",
              ]}
            >
              <FrozenChatHeader filesOpen={false} artifactsOpen={false} />
              <div className="flex flex-col items-center gap-3 px-6 py-8">
                <p className="text-base font-semibold text-foreground">
                  Start a new session
                </p>
                <p className="text-sm text-muted-foreground">
                  Send a message to begin or open a new session in:
                </p>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  {[
                    "Browser Terminal",
                    "Local Terminal",
                    "VS Code",
                    "Slack Channel",
                  ].map((t) => (
                    <div
                      key={t}
                      className="flex items-center gap-2 rounded-lg border border-border px-4 py-3 text-sm text-foreground"
                    >
                      <div className="h-5 w-5 rounded bg-muted" />
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            </Board>
          </BoardRow>
        </div>
      </div>
    </div>
  );
}
