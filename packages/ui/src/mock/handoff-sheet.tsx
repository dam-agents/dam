import {
  Add,
  ArrowLeft,
  Diagram,
  Folder,
  Notification,
} from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { AgentAvatar } from "../modules/agents/components/char-avatar.js";
import { useStore } from "../store.js";
import {
  type AgentChrome,
  LeftDockedPanel,
  type LeftPanelKind,
  WorkspaceChatHeader,
} from "./chat-workspace-variants.js";
import { MockBrowserPanel } from "./mock-browser-panel.js";

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

function SpecBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mt-6 max-w-[960px]">
      <p className="mb-2 text-sm font-semibold text-foreground">{title}</p>
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm leading-relaxed text-foreground">
        {children}
      </div>
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="mt-1 flex flex-col gap-1">
      {items.map((item) => (
        <li key={item} className="flex gap-2">
          <span className="shrink-0 text-muted-foreground">&middot;</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function StepList({ steps }: { steps: string[] }) {
  return (
    <ol className="mt-1 flex flex-col gap-1">
      {steps.map((step, i) => (
        <li key={step} className="flex gap-2">
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {i + 1}.
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function ProtoRef({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 text-sm italic text-muted-foreground">{children}</p>
  );
}

function Board({
  label,
  children,
  className,
  height,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  height?: string;
}) {
  return (
    <div className="mt-6">
      <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-background shadow-sm",
          className,
        )}
        style={height ? { height } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/* ─── Mock chrome for embedded real components ─── */

function makeMockChrome(overrides?: Partial<AgentChrome>): AgentChrome {
  return {
    agentId: "mock-agent-1",
    name: "ci-pipeline",
    statusDot: (
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-success" />
    ),
    menu: null,
    status: null,
    backButton: null,
    onOpenFile: () => {},
    onConfigure: () => {},
    ...overrides,
  };
}

/* ─── Interactive board showing header states ─── */

function HeaderBoard() {
  const [openPanels, setOpenPanels] = useState<Set<LeftPanelKind>>(new Set());
  const chrome = makeMockChrome();

  return (
    <Board label="Chat header — click toggles to see active states">
      <WorkspaceChatHeader
        chrome={chrome}
        openPanels={openPanels}
        onTogglePanel={(panel) =>
          setOpenPanels((prev) => {
            const next = new Set(prev);
            if (next.has(panel)) next.delete(panel);
            else next.add(panel);
            return next;
          })
        }
        onNewChat={() => {}}
      />
    </Board>
  );
}

/* ─── Interactive board showing left dock states ─── */

function LeftDockBoard() {
  const [openPanels, setOpenPanels] = useState<Set<LeftPanelKind>>(
    new Set(["files"]),
  );

  const chrome = makeMockChrome();

  const togglePanel = (panel: LeftPanelKind) => {
    setOpenPanels((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) next.delete(panel);
      else next.add(panel);
      return next;
    });
  };

  return (
    <Board label="Left dock — click buttons to toggle panels" height="420px">
      <div className="flex h-full">
        <LeftDockedPanel
          openPanels={openPanels}
          chrome={chrome}
          onClosePanel={(panel) =>
            setOpenPanels((prev) => {
              const next = new Set(prev);
              next.delete(panel);
              return next;
            })
          }
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-sm text-muted-foreground">Toggle panels:</p>
          <div className="flex items-center gap-2">
            <Button
              variant={openPanels.has("files") ? "default" : "outline"}
              size="sm"
              onClick={() => togglePanel("files")}
            >
              <Folder size={16} />
              Files
            </Button>
            <Button
              variant={openPanels.has("artifacts") ? "default" : "outline"}
              size="sm"
              onClick={() => togglePanel("artifacts")}
            >
              <Diagram size={16} />
              Artifacts
            </Button>
          </div>
          <p className="max-w-[320px] text-center text-xs text-muted-foreground">
            280px fixed width &middot; 200ms ease transition &middot; both can
            be open simultaneously (stacked vertically with divider)
          </p>
        </div>
      </div>
    </Board>
  );
}

/* ─── Browser panel board ─── */

function BrowserBoard() {
  return (
    <Board label="Browser panel (right dock)" height="400px">
      <MockBrowserPanel agentId="mock-agent-1" agentName="ci-pipeline" />
    </Board>
  );
}

/* ─── Full layout board ─── */

function FullLayoutBoard() {
  const [openPanels, setOpenPanels] = useState<Set<LeftPanelKind>>(
    new Set(["files"]),
  );
  const chrome = makeMockChrome();

  return (
    <Board label="Full layout — header + left dock + right dock" height="520px">
      <div className="flex h-full flex-col">
        <div
          className={cn(
            "flex shrink-0 items-center justify-end border-b px-6 h-10 transition-colors duration-200",
            openPanels.size > 0 ? "border-border" : "border-transparent",
          )}
        >
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Activity"
          >
            <Notification size={16} />
          </button>
        </div>
        <WorkspaceChatHeader
          chrome={chrome}
          openPanels={openPanels}
          onTogglePanel={(panel) =>
            setOpenPanels((prev) => {
              const next = new Set(prev);
              if (next.has(panel)) next.delete(panel);
              else next.add(panel);
              return next;
            })
          }
          onNewChat={() => {}}
        />
        <div className="flex flex-1 min-h-0">
          <LeftDockedPanel
            openPanels={openPanels}
            chrome={chrome}
            onClosePanel={(panel) =>
              setOpenPanels((prev) => {
                const next = new Set(prev);
                next.delete(panel);
                return next;
              })
            }
          />
          <div className="flex flex-1 flex-col items-center justify-center min-w-0">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm font-medium text-foreground">
                Chat messages area
              </p>
              <p className="text-xs text-muted-foreground">
                Messages render here with scroll-aware gradients
              </p>
            </div>
          </div>
          <div className="w-px bg-border" />
          <div className="flex w-[380px] shrink-0 flex-col">
            <MockBrowserPanel agentId="mock-agent-1" agentName="ci-pipeline" />
          </div>
        </div>
      </div>
    </Board>
  );
}

/* ─── Bell strip board ─── */

function BellStripBoard() {
  return (
    <div className="mt-6 flex gap-4">
      <div className="flex-1">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Bell strip — panels closed (border transparent)
        </p>
        <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <div className="flex h-10 shrink-0 items-center justify-end border-b border-transparent px-6">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
              aria-label="Activity"
            >
              <Notification size={16} />
            </button>
          </div>
        </div>
      </div>
      <div className="flex-1">
        <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Bell strip — panels open (border visible)
        </p>
        <div className="overflow-hidden rounded-xl border border-border bg-background shadow-sm">
          <div className="flex h-10 shrink-0 items-center justify-end border-b border-border px-6">
            <button
              type="button"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground"
              aria-label="Activity"
            >
              <Notification size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Input bar visual reference ─── */

function InputBarBoard() {
  return (
    <Board label="Input bar layout" className="p-4">
      <div className="mx-auto max-w-[813px]">
        <div className="flex items-end gap-0 rounded-xl border border-border bg-background px-1 py-1 shadow-sm transition-colors focus-within:border-primary">
          <button
            type="button"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Add size={16} />
          </button>
          <div className="flex flex-1 items-center px-2 py-2">
            <span className="text-sm text-muted-foreground">
              Every Friday, file GitHub issues for usability problems raised in
              #team-help
            </span>
          </div>
          <Button size="sm" className="shrink-0 rounded-lg">
            Send
          </Button>
        </div>
        <div className="mt-2 flex items-center gap-3 px-1">
          <span className="text-xs text-muted-foreground">
            + button opens the plus menu &middot; Tab fills the placeholder
            &middot; Enter sends &middot; Shift+Enter for newline
          </span>
        </div>
      </div>
    </Board>
  );
}

/* ─── Agent header trigger visual ─── */

function AgentTriggerBoard() {
  return (
    <Board label="Agent name trigger — opens configure modal" className="p-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="group flex items-center gap-2 rounded-lg py-1 pl-1 pr-3 transition-colors hover:bg-muted"
        >
          <AgentAvatar
            agentId="mock-agent-1"
            state="running"
            className="!size-6"
          />
          <span className="text-sm font-semibold text-foreground">
            ci-pipeline
          </span>
          <span
            aria-hidden
            className="h-2 w-2 shrink-0 rounded-full bg-success"
          />
        </button>
        <span className="text-xs text-muted-foreground">
          &larr; Click this trigger to open the configure modal to &ldquo;Agent
          Setup&rdquo;
        </span>
      </div>
    </Board>
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
          <SectionNote>
            Developer reference for the chat UI. Each section shows the real
            prototype component alongside behavioral specs. Interactive boards
            use the actual components &mdash; click toggles, buttons, and panels
            to see real states. For the full integrated experience, return to
            the prototype (back arrow above).
          </SectionNote>

          {/* ─── 1. Full Layout ─── */}
          <SectionTitle>1 &middot; Full Layout</SectionTitle>
          <SectionNote>
            The complete chat workspace: bell strip, header with toggles, left
            dock, chat messages area, and right dock. Toggle the panels and
            browser to see the layout respond.
          </SectionNote>

          <FullLayoutBoard />

          <SpecBlock title="Layout structure">
            <BulletList
              items={[
                "Bell strip (h-10): notification bell, right-aligned. Border appears only when any panel is open (left dock or right dock).",
                "Chat header (h-14): agent trigger (left), file/artifact/browser toggles, quick-find search, status + new-chat button (right).",
                "Left dock: 280px fixed width, slides open with 200ms ease transition.",
                "Chat area: flex-1 min-w-0, messages with scroll-aware gradients, input bar at bottom.",
                "Right dock: drag-resizable (min 240px, max 2/3 container), opens for artifact viewer or browser.",
              ]}
            />
          </SpecBlock>

          <BellStripBoard />

          {/* ─── 2. Chat Header ─── */}
          <SectionTitle>2 &middot; Chat Header</SectionTitle>
          <SectionNote>
            The real header component with interactive toggles. Click the
            Folder, Diagram, and Wikis (browser) buttons to see their active
            states.
          </SectionNote>

          <HeaderBoard />

          <SpecBlock title="Header elements (left to right)">
            <BulletList
              items={[
                "Agent trigger: avatar + name + status dot — click opens configure modal.",
                "Files toggle (Folder icon): 8×8 rounded-lg button, highlights bg-muted when active.",
                "Artifacts toggle (Diagram icon): same style, opens artifacts panel in left dock.",
                "Browser toggle (Wikis icon): same style, opens browser in right dock.",
                "Quick-find search bar (centered): 280px, rounded-full bg-muted/70, ⌘K shortcut.",
                "Status area (right): background work indicator, badges, contribution failures.",
                "New chat button (mock mode only): outline variant with + icon.",
              ]}
            />
          </SpecBlock>

          <AgentTriggerBoard />

          {/* ─── 3. Left Dock (Files + Artifacts) ─── */}
          <SectionTitle>3 &middot; Left Dock (Files + Artifacts)</SectionTitle>
          <SectionNote>
            Left-docked panels toggled from the chat header. The real
            LeftDockedPanel component renders below &mdash; toggle the buttons
            to see single-panel and dual-panel states.
          </SectionNote>

          <LeftDockBoard />

          <SpecBlock title="Panel behavior">
            <BulletList
              items={[
                "280px fixed width with w-0 → w-[280px] transition (200ms ease cubic-bezier(0.32,0.72,0,1)).",
                "Border-r transitions from transparent (closed) to border-border (open).",
                "Both panels can be open simultaneously — they stack vertically with flex-1 min-h-0 and a border-t divider.",
                "Each panel has a header (title + close X) and scrollable content area.",
                "Close via X button in panel header, or re-click the toggle button in the chat header.",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Files panel">
            <BulletList
              items={[
                "Body: DirContents tree (real file tree from agent workspace).",
                "Drag-and-drop upload: drop zone overlay appears on drag-enter.",
                '"Add file" dropdown: Upload file, Upload folder, New file, New folder.',
                'Empty state: "No files yet" centered message.',
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Artifacts panel">
            <BulletList
              items={[
                "Body: artifact rows with ArtifactKindBadge icons.",
                "Click a row to toggle the docked artifact viewer (right dock).",
                'Empty states: "No artifacts yet" / "No matching artifacts" / "Loading…".',
              ]}
            />
          </SpecBlock>

          <SpecBlock title="QuickFind (⌘K)">
            <BulletList
              items={[
                "560px centered dialog with search input.",
                "Searches both files and artifacts simultaneously.",
                "Click a result to open it; Escape or backdrop click to dismiss.",
              ]}
            />
          </SpecBlock>

          {/* ─── 4. Right Dock (Browser) ─── */}
          <SectionTitle>
            4 &middot; Right Dock (Artifact Viewer + Browser)
          </SectionTitle>
          <SectionNote>
            The real MockBrowserPanel component renders below. The right dock is
            shared between the artifact viewer and browser &mdash; only one
            occupies the slot at a time.
          </SectionNote>

          <BrowserBoard />

          <SpecBlock title="Opening and sizing">
            <BulletList
              items={[
                "Opens when an artifact is clicked or browser toggle (Wikis icon) is clicked.",
                "Animates with flex-grow transition (200ms ease cubic-bezier(0.32,0.72,0,1)).",
                "Drag resize: ResizeHandle fires onResize on every mousemove, onDragEnd on mouseup.",
                "CSS transition disabled during active drag (draggingRight state) — panel tracks cursor instantly.",
                "Transition re-enables on drag end for smooth open/close animation.",
                "Max width: 2/3 of available horizontal space. Min width: 240px.",
                "Persisted width stored in localStorage as 'platform-file-w'.",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Browser panel elements">
            <BulletList
              items={[
                "Toolbar (h-12): Wikis accent badge (22×22, rounded-md, bg-accent-light), back/forward (disabled in mock), address bar (mono font), reload, overflow menu (Restart browser, Clear browser data), maximize/restore, close.",
                'Info bar: "Runs in {agentName}\'s sandbox — not a page from this site".',
                "Content: browser preview placeholder in mock mode (Wikis icon + url if navigated).",
                "Maximize: fills the entire workspace area (chat and left dock hidden).",
              ]}
            />
          </SpecBlock>

          {/* ─── 5. Plus Menu ─── */}
          <SectionTitle>5 &middot; Plus Menu</SectionTitle>
          <SectionNote>
            Opened from the + button at the left edge of the input bar. Root
            menu slides left to reveal sub-panels (150ms ease-in-out
            translateX). Open the prototype to interact with the full popover.
          </SectionNote>

          <SpecBlock title="How to open">
            <StepList
              steps={[
                "Click the + button in the input bar.",
                "A popover appears (side=top, align=start, 360px wide, max 60vh).",
                "Root menu shows: Attach file, Skills (badge: count on), Schedules (badge: active count), Connections (badge: total count).",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Navigation">
            <BulletList
              items={[
                "Skills, Schedules, Connections rows each have a right chevron.",
                "Clicking a row slides the root menu left, revealing that sub-panel (150ms ease).",
                "Back arrow in the sub-panel header slides back to root.",
                '"Manage" link in each sub-panel header opens the configure modal to that section.',
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Skills sub-panel">
            <BulletList
              items={[
                'Header: back arrow + "Skills" title + "Manage" link.',
                'Skills grouped by source ("Created in this agent", source repo name, "Included with sandbox image").',
                "Each skill row: name, optional source badge, optional Update link (when upstream changed), on/off toggle.",
                'Footer: "Add source" button + "Or, describe to create" text link.',
                'Empty state: dashed border drop zone: "Drop a .md file here, add a source, or describe what you need below".',
                "Accepts .md file drag-and-drop (opens add-source modal).",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Schedules sub-panel">
            <BulletList
              items={[
                'Header: back arrow + "Schedules" title + "Manage" link.',
                "Schedule rows: icon badge (blue when enabled, gray when paused), name, cadence text, on/off toggle, overflow menu.",
                "Search input appears when > 6 schedules.",
                'Footer: "Add schedule" button + "Or, describe to create" text link.',
                'Empty state: "No schedules yet" + "Describe what you need and the agent will set one up" + "Describe it" button.',
                "Toggle: enables/disables schedule, shows toast confirmation.",
                'Overflow menu: "Edit schedule" (opens ScheduleFormModal).',
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Connections sub-panel">
            <BulletList
              items={[
                'Header: back arrow + "Connections" title + "Manage" link.',
                "Connections grouped by provider (GitHub, Slack, etc.), each in a card with provider name and connection count.",
                "Each connection row: name + grant/revoke toggle.",
                "Search input appears when > 6 connections. Badge turns danger if any connection is expired/disconnected.",
                'Footer: "Add connection" button → opens ConnectionCatalogModal.',
                'Empty state: "No connections configured" + "Add connection" button.',
                "Loading state: 3 skeleton rows with pulse animation.",
              ]}
            />
          </SpecBlock>

          <ProtoRef>
            Open the prototype &rarr; click the + button in the input bar to see
            all plus menu states and sub-panels.
          </ProtoRef>

          {/* ─── 6. Chat Scroll Behavior ─── */}
          <SectionTitle>6 &middot; Chat Scroll Behavior</SectionTitle>
          <SectionNote>
            Fade gradients at the top and bottom edges of the chat message area
            provide visual continuity when scrolling.
          </SectionNote>

          <SpecBlock title="Top gradient">
            <BulletList
              items={[
                "Appears only when user has scrolled down (scrollTop > 8px).",
                "If content fits or user is at the very top — no gradient, text reaches the header.",
                "32px tall, pointer-events-none, bg-gradient-to-b from background to transparent.",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Bottom gradient">
            <BulletList
              items={[
                "Appears when there is more content below (user is not near bottom).",
                "Meets the input bar flush with no gap.",
                "32px tall, pointer-events-none, bg-gradient-to-t from background to transparent.",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Jump to latest button">
            <BulletList
              items={[
                "Appears when scrolled up from bottom (showJump state).",
                'Centered pill: "Jump to latest" with ArrowDown icon.',
                "Rounded-full border border-border bg-background shadow, hover:bg-muted.",
                "Clicking scrolls to bottom and hides the button.",
              ]}
            />
          </SpecBlock>

          <ProtoRef>
            Open the prototype &rarr; scroll the chat messages to see gradients
            and the jump button.
          </ProtoRef>

          {/* ─── 7. Input Bar ─── */}
          <SectionTitle>7 &middot; Input Bar</SectionTitle>
          <SectionNote>
            Primary interaction surface at the bottom of the chat. The real
            input bar component is tightly integrated with the chat store
            &mdash; see the reference layout below and interact with it in the
            prototype.
          </SectionNote>

          <InputBarBoard />

          <SpecBlock title="Placeholder rotation">
            <BulletList
              items={[
                "7 placeholder texts rotate every 6 seconds with a 400ms fade transition.",
                "Tab key fills the current suggestion into the input.",
                "Tab badge shown inline next to placeholder text.",
                "Covers: Schedules, Skills, Slack, Artifacts, Code, Connections, Memory.",
                'When computing: placeholder changes to "Queue a message...", send button label becomes "Queue".',
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Attachments">
            <BulletList
              items={[
                "Added via Attach file menu, paste (Ctrl+V), or drag-and-drop.",
                "Images: 56px thumbnail with red X remove button.",
                "Documents: filename pill with Document icon and X remove.",
                "Shown above the textarea inside the input container.",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Keyboard">
            <BulletList
              items={[
                "Enter sends the message.",
                "Shift+Enter inserts a newline.",
                "Mobile: Enter does not send (platform detection).",
                "Input auto-focuses on new chat, or when user clicks back to the main area.",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Prefill from panels">
            <BulletList
              items={[
                '"Or, describe to create" in Skills panel prefills: "Create a skill that..." and focuses input.',
                '"Describe it" in Schedules panel prefills: "Every morning at 9am..." and focuses input.',
                "Drafts persist per session via zustand with ~new sentinel for blank chats.",
              ]}
            />
          </SpecBlock>

          <ProtoRef>
            Open the prototype &rarr; interact with the input bar. Click +, type
            text, wait for placeholder rotation, press Tab to fill.
          </ProtoRef>

          {/* ─── 8. Configure Modal ─── */}
          <SectionTitle>8 &middot; Configure Modal</SectionTitle>
          <SectionNote>
            960px modal with 220px left nav. Lazy-loaded with React.lazy() and
            Suspense. Open it in the prototype by clicking the agent name in the
            header.
          </SectionNote>

          <AgentTriggerBoard />

          <SpecBlock title="Layout">
            <BulletList
              items={[
                "960px wide modal, centered, with 220px left nav sidebar.",
                "7 nav sections: Agent Setup, Connections, Channels, Skills, Schedules, Artifacts, Usage.",
                "Each nav item shows a summary line (e.g. '2 CPU · 2 Gi') and optional warning dot.",
                "Right content area is scrollable (max 70vh).",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="How to open">
            <BulletList
              items={[
                "Click agent avatar/name in chat header → opens to Agent Setup section.",
                '"Manage" link in any plus menu sub-panel → opens to that section.',
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Restart UX (Agent Setup only)">
            <StepList
              steps={[
                "User changes CPU or memory sliders on a running agent.",
                "Footer shows warning: Renew icon + 'Saving will restart the agent to apply its new size.'",
                'Save button label changes from "Submit changes" to "Save & restart".',
                'On save: confirmation dialog — "Saving will restart the agent to apply its new size — in-flight work is interrupted." with "Restart agent?" title.',
                "If agent is hibernated or over budget: no restart warning, new size applies on next start.",
              ]}
            />
          </SpecBlock>

          <ProtoRef>
            Open the prototype &rarr; click the agent name in the chat header to
            open the configure modal. Navigate between sections using the left
            nav.
          </ProtoRef>

          {/* ─── 9. New Chat ─── */}
          <SectionTitle>9 &middot; New Chat</SectionTitle>
          <SectionNote>
            Session is not created until the first message is sent. Textarea
            auto-focuses on the next animation frame after reset.
          </SectionNote>

          <SpecBlock title="Flow">
            <StepList
              steps={[
                'Click "New chat" button in the header bar.',
                "resetSession() clears current session state.",
                "Textarea focuses on next animation frame.",
                "No session ID exists yet — created on first message send.",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Empty state (mock)">
            <BulletList
              items={[
                "Empty centered flex container.",
                "Rotating placeholder text in the input bar guides the user.",
              ]}
            />
          </SpecBlock>

          <SpecBlock title="Empty state (production)">
            <BulletList
              items={[
                '"Start a new session" heading.',
                '"Send a message to begin or open a new session in:" subtext.',
                "Launcher tile grid (2 columns): Browser Terminal, Local Terminal, VS Code/Zed, Slack Channel.",
                "Each tile: icon + title + description.",
              ]}
            />
          </SpecBlock>

          <ProtoRef>
            Open the prototype &rarr; click &ldquo;New chat&rdquo; in the header
            to see the empty state.
          </ProtoRef>
        </div>
      </div>
    </div>
  );
}
