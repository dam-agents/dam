import {
  Add,
  ChevronDown,
  ChevronRight,
  Document,
  Folder,
  Launch,
  Notification,
  OverflowMenuVertical,
  Renew,
  Send,
  Subtract,
} from "@carbon/icons-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { stateDotClass } from "../components/status-indicator.js";
import { HomeView } from "../modules/home/views/home-view.js";
import { parseRoute } from "../modules/platform/lib/routes.js";
import { ChatColumn } from "../modules/sessions/components/chat-column.js";
import { ChatMessage } from "../modules/sessions/components/chat-message.js";
import { mockTranscript } from "./data/transcripts.js";
import {
  CollapsedNav,
  ExpandedNav,
  type ExpandedNavProps,
  type RailPopover,
} from "./sidebar-specs.js";

const SCREEN_W = 1440;
const SCREEN_H = 900;
const EXPANDED_W = 320;
const COLLAPSED_W = 56;
const ZOOM_KEY = "platform-nav-flows-zoom";
const ZOOM_STEPS = [0.1, 0.15, 0.2, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5];

type NavConfig =
  | ({ kind: "expanded" } & ExpandedNavProps)
  | {
      kind: "collapsed";
      unreadActivity?: boolean;
      hoverLogo?: boolean;
      hoverItem?: string;
      popover?: RailPopover;
    };

interface ScreenSpec {
  title: string;
  annotation?: string;
  nav: NavConfig;
  body: "home" | "chat";
  chatSessionId?: string;
}

interface FlowSpec {
  id: string;
  name: string;
  screens: ScreenSpec[];
}

interface ComponentState {
  title: string;
  annotation?: string;
  nav: NavConfig;
  canvas?: number;
}

interface ComponentSpec {
  id: string;
  name: string;
  states: ComponentState[];
}

const CHAT_AGENT_ID = "a1b2c3d4-0001-4000-8000-000000000001";
const CHAT_SESSION_ID = "sess-0001-002";

const COMPONENTS: ComponentSpec[] = [
  {
    id: "collapsed-nav",
    name: "Collapsed nav",
    states: [
      {
        title: "At rest, unread activity",
        nav: { kind: "collapsed", unreadActivity: true },
        canvas: 200,
      },
      { title: "Nothing unread", nav: { kind: "collapsed" }, canvas: 200 },
      {
        title: "Logo hover: expand",
        annotation: "Hover",
        nav: { kind: "collapsed", unreadActivity: true, hoverLogo: true },
        canvas: 240,
      },
      {
        title: "Icon tooltip",
        annotation: "Hover",
        nav: { kind: "collapsed", unreadActivity: true, hoverItem: "Agents" },
        canvas: 200,
      },
      {
        title: "Agents popover",
        annotation: "Click",
        nav: { kind: "collapsed", unreadActivity: true, popover: "agents" },
        canvas: 320,
      },
      {
        title: "Activity popover",
        annotation: "Click",
        nav: { kind: "collapsed", unreadActivity: true, popover: "activity" },
        canvas: 320,
      },
      {
        title: "Activity filter menu",
        annotation: "Click",
        nav: {
          kind: "collapsed",
          unreadActivity: true,
          popover: "activity-filter",
        },
        canvas: 380,
      },
    ],
  },
  {
    id: "agent-row",
    name: "Agent row",
    states: [
      { title: "At rest: unread dots, status dots", nav: { kind: "expanded" } },
      {
        title: "Row hover",
        annotation: "Hover",
        nav: { kind: "expanded", hoverAgent: { id: "s1", target: "row" } },
      },
      {
        title: "New chat hover",
        annotation: "Hover",
        nav: { kind: "expanded", hoverAgent: { id: "s2", target: "newChat" } },
        canvas: 120,
      },
      {
        title: "Overflow hover",
        annotation: "Hover",
        nav: { kind: "expanded", hoverAgent: { id: "s2", target: "overflow" } },
      },
      {
        title: "Overflow menu open",
        annotation: "Click",
        nav: { kind: "expanded", hoverAgent: { id: "s2", target: "menu" } },
      },
      {
        title: "Selected + expanded",
        annotation: "Click",
        nav: { kind: "expanded", expandedAgentId: "s1" },
      },
      {
        title: "All statuses (See all)",
        nav: { kind: "expanded", showAll: true },
      },
    ],
  },
  {
    id: "session-row",
    name: "Session row (inside an agent)",
    states: [
      {
        title: "Default: running, unread, schedule",
        nav: { kind: "expanded", expandedAgentId: "s1" },
      },
      {
        title: "Session hover",
        annotation: "Hover",
        nav: { kind: "expanded", expandedAgentId: "s1", hoverSessionId: "ms2" },
      },
      {
        title: "Active session",
        annotation: "Click",
        nav: {
          kind: "expanded",
          expandedAgentId: "s1",
          activeSessionId: "ms2",
        },
      },
    ],
  },
  {
    id: "activity",
    name: "Activity",
    states: [
      { title: "At rest", nav: { kind: "expanded" } },
      {
        title: "Row hover",
        annotation: "Hover",
        nav: { kind: "expanded", hoverActivityId: "ms3" },
      },
      {
        title: "Filter menu open",
        annotation: "Click",
        nav: { kind: "expanded", filter: "open" },
        canvas: 100,
      },
      {
        title: "Filter menu, filtered to Unread",
        annotation: "Click",
        nav: { kind: "expanded", filter: "open-filtered" },
        canvas: 100,
      },
      {
        title: "Filtered to Unread",
        nav: { kind: "expanded", filter: "filtered" },
      },
      { title: "Empty", nav: { kind: "expanded", empty: true } },
    ],
  },
  {
    id: "nav-chrome",
    name: "Nav items and headers",
    states: [
      {
        title: "Nav item hover",
        annotation: "Hover",
        nav: { kind: "expanded", hoverNav: "Artifacts" },
      },
      {
        title: "Create agent hover",
        annotation: "Hover",
        nav: { kind: "expanded", hoverCreate: true },
        canvas: 160,
      },
      {
        title: "Scrolled: sticky header border",
        nav: { kind: "expanded", expandedAgentId: "s1", scrollTop: 120 },
      },
    ],
  },
];

const FLOWS: FlowSpec[] = [
  {
    id: "flow-1",
    name: "Home page (Agents)",
    screens: [
      { title: "Home", nav: { kind: "expanded" }, body: "home" },
      {
        title: "See all agents",
        nav: { kind: "expanded", showAll: true },
        body: "home",
      },
    ],
  },
  {
    id: "flow-2",
    name: "Nav open",
    screens: [
      { title: "At rest", nav: { kind: "expanded" }, body: "home" },
      {
        title: "Hover agent, New chat, nav item",
        annotation: "Hover states",
        nav: {
          kind: "expanded",
          hoverAgent: { id: "s2", target: "newChat" },
          hoverNav: "Artifacts",
        },
        body: "home",
      },
      {
        title: "Agent overflow menu",
        annotation: "Agent actions",
        nav: {
          kind: "expanded",
          hoverAgent: { id: "s2", target: "menu" },
          hoverActivityId: "ms3",
        },
        body: "home",
      },
      {
        title: "Filter menu open",
        annotation: "Filtering activity",
        nav: { kind: "expanded", filter: "open-filtered", hoverCreate: true },
        body: "home",
      },
      {
        title: "Filtered to Unread",
        nav: { kind: "expanded", filter: "filtered" },
        body: "home",
      },
    ],
  },
  {
    id: "flow-3",
    name: "Agents expanded (viewing agent-specific sessions)",
    screens: [
      {
        title: "Hover agent",
        nav: { kind: "expanded", hoverAgent: { id: "s1", target: "row" } },
        body: "home",
      },
      {
        title: "Agent clicked: sessions open",
        nav: { kind: "expanded", expandedAgentId: "s1" },
        body: "home",
      },
      {
        title: "Hover session",
        annotation: "Hover states",
        nav: { kind: "expanded", expandedAgentId: "s1", hoverSessionId: "ms2" },
        body: "home",
      },
      {
        title: "Session opened",
        nav: {
          kind: "expanded",
          expandedAgentId: "s1",
          activeSessionId: "ms2",
        },
        body: "chat",
        chatSessionId: CHAT_SESSION_ID,
      },
    ],
  },
  {
    id: "flow-4",
    name: "Nav closed",
    screens: [
      {
        title: "At rest",
        nav: { kind: "collapsed", unreadActivity: true },
        body: "home",
      },
      {
        title: "Icon tooltip",
        annotation: "Hover states (when nav closed)",
        nav: { kind: "collapsed", unreadActivity: true, hoverItem: "Agents" },
        body: "home",
      },
      {
        title: "Logo hover: expand",
        annotation: "Hover states (when nav closed)",
        nav: { kind: "collapsed", unreadActivity: true, hoverLogo: true },
        body: "home",
      },
      {
        title: "Activity popover",
        annotation: "Activity click (when nav closed)",
        nav: { kind: "collapsed", unreadActivity: true, popover: "activity" },
        body: "home",
      },
      {
        title: "Activity filter",
        annotation: "Activity click (when nav closed)",
        nav: {
          kind: "collapsed",
          unreadActivity: true,
          popover: "activity-filter",
        },
        body: "home",
      },
      {
        title: "Agents popover",
        annotation: "Agent click (when nav closed)",
        nav: { kind: "collapsed", unreadActivity: true, popover: "agents" },
        body: "home",
      },
    ],
  },
];

function FrozenNav({ nav }: { nav: NavConfig }) {
  return nav.kind === "expanded" ? (
    <ExpandedNav {...nav} />
  ) : (
    <CollapsedNav {...nav} />
  );
}

function HomeBody() {
  return (
    <div className="relative h-full overflow-y-auto">
      <span className="absolute top-3 right-6 z-10 flex h-8 w-8 items-center justify-center text-muted-foreground">
        <Notification size={16} />
      </span>
      <HomeView />
    </div>
  );
}

const FILE_ROWS = [
  { name: "src", dir: true },
  { name: "tests", dir: true },
  { name: "package.json" },
  { name: "tsconfig.json" },
  { name: "README.md" },
];

function ChatBody({ sessionId }: { sessionId: string }) {
  const messages = mockTranscript(CHAT_AGENT_ID, sessionId);
  return (
    <div className="flex h-full">
      <div className="flex w-[220px] shrink-0 flex-col border-r border-border">
        <div className="flex items-center gap-2 border-b border-border p-3">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              stateDotClass.running,
            )}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            ci-pipeline
          </span>
          <span className="flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground">
            <OverflowMenuVertical size={16} />
          </span>
        </div>
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <ChevronDown size={16} className="text-muted-foreground" />
          <span className="flex-1 text-sm font-medium text-foreground">
            Files
          </span>
          <span className="flex h-6 items-center gap-1 rounded-md border border-border px-2 text-sm text-foreground">
            <Add size={16} /> Add
          </span>
        </div>
        <div className="flex flex-1 flex-col py-1">
          {FILE_ROWS.map((f) => (
            <span
              key={f.name}
              className="flex h-8 cursor-pointer items-center gap-1.5 px-3 text-sm text-muted-foreground hover:bg-muted"
            >
              {f.dir ? (
                <>
                  <ChevronRight size={16} />
                  <Folder size={16} />
                </>
              ) : (
                <>
                  <span className="w-4" />
                  <Document size={16} />
                </>
              )}
              {f.name}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
          <ChevronRight size={16} className="text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">Artifacts</span>
        </div>
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ChatColumn className="flex flex-col gap-8 px-8 py-8">
            {messages.map((m, i) => (
              <ChatMessage
                key={m.id}
                message={m}
                isLast={i === messages.length - 1}
                hasPendingPermission={false}
                onRetry={() => {}}
                onFileClick={() => {}}
              />
            ))}
          </ChatColumn>
        </div>
        <div className="px-8 pb-6">
          <ChatColumn>
            <div className="flex items-center gap-3 rounded-2xl border border-border px-5 py-4 text-sm text-muted-foreground">
              <Add size={16} />
              <span className="flex-1">Message ci-pipeline</span>
              <Send size={16} />
            </div>
          </ChatColumn>
        </div>
      </div>
    </div>
  );
}

export function FlowScreen() {
  const route = parseRoute(window.location.pathname);
  const screen =
    route.view === "flow-screen"
      ? FLOWS.find((f) => f.id === route.flowId)?.screens[route.screen]
      : undefined;
  if (!screen) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Screen not found
      </div>
    );
  }
  const navWidth = screen.nav.kind === "expanded" ? EXPANDED_W : COLLAPSED_W;
  return (
    <div className="flex h-full bg-background">
      <nav
        className="relative z-10 h-full shrink-0 border-r border-border bg-card"
        style={{ width: navWidth }}
      >
        <FrozenNav nav={screen.nav} />
      </nav>
      <main className="relative min-w-0 flex-1 overflow-hidden">
        {screen.body === "home" ? (
          <HomeBody />
        ) : (
          <ChatBody sessionId={screen.chatSessionId ?? CHAT_SESSION_ID} />
        )}
      </main>
    </div>
  );
}

function FrameLabel({
  id,
  title,
  annotation,
  actions,
}: {
  id: string;
  title: string;
  annotation?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex min-h-[88px] items-end justify-between gap-4">
      <div className="min-w-0">
        {annotation && (
          <p className="text-2xl font-semibold text-[#8a3ffc]">{annotation}</p>
        )}
        <p className="truncate text-3xl text-foreground/70">
          <span className="mr-3 font-semibold text-foreground">{id}</span>
          {title}
        </p>
      </div>
      {actions}
    </div>
  );
}

function AnnotationBar({ show }: { show: boolean }) {
  return <div className={cn("h-2.5", show && "bg-[#8a3ffc]")} />;
}

function RowCard({ label, name }: { label: string; name: string }) {
  return (
    <div className="shrink-0" style={{ width: 720 }}>
      <FrameLabel id={label} title="" />
      <AnnotationBar show={false} />
      <div
        className="flex items-center bg-[#161616] px-16"
        style={{ height: SCREEN_H }}
      >
        <p className="text-6xl leading-tight text-white">{name}</p>
      </div>
    </div>
  );
}

const FRAME_ACTION =
  "flex h-12 items-center gap-2 rounded-lg bg-background/80 px-4 text-2xl text-foreground hover:bg-background";

function FlowFrame({
  id,
  flowId,
  index,
  screen,
}: {
  id: string;
  flowId: string;
  index: number;
  screen: ScreenSpec;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const src = `/flow-screen/${flowId}/${index}`;
  return (
    <div className="shrink-0" style={{ width: SCREEN_W }}>
      <FrameLabel
        id={id}
        title={screen.title}
        annotation={screen.annotation}
        actions={
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={() => setReloadKey((k) => k + 1)}
              className={FRAME_ACTION}
            >
              <Renew size={16} /> Reset
            </button>
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className={FRAME_ACTION}
            >
              <Launch size={16} /> Open
            </a>
          </div>
        }
      />
      <AnnotationBar show={!!screen.annotation} />
      <iframe
        key={reloadKey}
        src={src}
        title={`${id} ${screen.title}`}
        width={SCREEN_W}
        height={SCREEN_H}
        loading="lazy"
        className="block bg-background shadow-md"
      />
    </div>
  );
}

function ComponentFrame({ id, state }: { id: string; state: ComponentState }) {
  const navWidth = state.nav.kind === "expanded" ? EXPANDED_W : COLLAPSED_W;
  const canvas = state.canvas ?? 0;
  const width = navWidth + canvas;
  return (
    <div className="shrink-0" style={{ width: Math.max(width, 400) }}>
      <FrameLabel id={id} title={state.title} annotation={state.annotation} />
      <AnnotationBar show={!!state.annotation} />
      <div
        className="relative flex overflow-hidden bg-background shadow-md"
        style={{ width, height: SCREEN_H }}
      >
        <div
          className="relative z-10 h-full shrink-0 border-r border-border bg-card"
          style={{ width: navWidth }}
        >
          <FrozenNav nav={state.nav} />
        </div>
        {canvas > 0 && <div className="flex-1 bg-background" />}
      </div>
    </div>
  );
}

function SectionHeading({ title, note }: { title: string; note: string }) {
  return (
    <div className="mb-16 max-w-[2400px]">
      <h2 className="text-7xl font-bold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="mt-4 text-3xl leading-relaxed text-muted-foreground">
        {note}
      </p>
    </div>
  );
}

function clampZoom(z: number) {
  return Math.min(1.5, Math.max(0.1, z));
}

function readZoom(): number {
  try {
    const v = Number(localStorage.getItem(ZOOM_KEY));
    return v > 0 ? clampZoom(v) : 0.25;
  } catch {
    return 0.25;
  }
}

function saveZoom(z: number) {
  try {
    localStorage.setItem(ZOOM_KEY, String(z));
  } catch {}
}

function ZoomToolbar({
  zoom,
  setZoom,
  onFit,
}: {
  zoom: number;
  setZoom: (z: number) => void;
  onFit: () => void;
}) {
  const step = (dir: 1 | -1) => {
    const next =
      dir === 1
        ? ZOOM_STEPS.find((s) => s > zoom + 0.001)
        : [...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.001);
    setZoom(next ?? zoom);
  };
  const btn =
    "flex h-8 min-w-8 items-center justify-center rounded-md px-2 text-sm text-foreground transition-colors hover:bg-muted";
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-sm">
      <button
        type="button"
        aria-label="Zoom out"
        onClick={() => step(-1)}
        className={btn}
      >
        <Subtract size={16} />
      </button>
      <span className="w-14 text-center text-sm tabular-nums text-foreground">
        {Math.round(zoom * 100)}%
      </span>
      <button
        type="button"
        aria-label="Zoom in"
        onClick={() => step(1)}
        className={btn}
      >
        <Add size={16} />
      </button>
      <span className="mx-1 h-5 w-px bg-border" />
      <button type="button" onClick={onFit} className={btn}>
        Fit
      </button>
      <button type="button" onClick={() => setZoom(1)} className={btn}>
        100%
      </button>
    </div>
  );
}

export function NavFlows() {
  const [zoom, setZoomState] = useState(readZoom);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const zoomAround = useCallback(
    (z: number, anchorX?: number, anchorY?: number) => {
      const el = scrollRef.current;
      const prev = zoomRef.current;
      const next = clampZoom(z);
      if (el) {
        const ax = anchorX ?? el.clientWidth / 2;
        const ay = anchorY ?? el.clientHeight / 2;
        const contentX = (el.scrollLeft + ax) / prev;
        const contentY = (el.scrollTop + ay) / prev;
        requestAnimationFrame(() => {
          el.scrollLeft = contentX * next - ax;
          el.scrollTop = contentY * next - ay;
        });
      }
      zoomRef.current = next;
      setZoomState(next);
      saveZoom(next);
    },
    [],
  );

  const setZoom = useCallback((z: number) => zoomAround(z), [zoomAround]);

  const fit = useCallback(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    setZoom(
      (el.clientWidth - 48) / (content.getBoundingClientRect().width / zoom),
    );
  }, [setZoom, zoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomAround(
        zoomRef.current * Math.exp(-e.deltaY * 0.01),
        e.clientX - rect.left,
        e.clientY - rect.top,
      );
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAround]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "=" || e.key === "+") setZoom(zoom * 1.25);
      else if (e.key === "-") setZoom(zoom / 1.25);
      else if (e.key === "0") setZoom(1);
      else if (e.key === "1") fit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, setZoom, fit]);

  return (
    <div className="flex h-full flex-col bg-[#e0e0e0] dark:bg-[#262626]">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-5 py-3">
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-foreground">
            Left nav — components and flows
          </h1>
          <p className="text-sm text-muted-foreground">
            Every frame is live at real browser size (1440×900): hover, click
            and inspect it. Zoom with the controls, Ctrl/⌘ + scroll, or + / − /
            0 (100%) / 1 (fit).
          </p>
        </div>
        <ZoomToolbar zoom={zoom} setZoom={setZoom} onFit={fit} />
      </header>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div ref={contentRef} className="w-max p-24" style={{ zoom }}>
          <SectionHeading
            title="Components"
            note="Each row is one component. Its states run left to right, shown in place inside a full-height nav."
          />
          <div className="flex flex-col gap-32">
            {COMPONENTS.map((comp, ci) => (
              <section key={comp.id} className="flex items-start gap-12">
                <RowCard label={`C${ci + 1}`} name={comp.name} />
                {comp.states.map((state, si) => (
                  <ComponentFrame
                    key={state.title}
                    id={`C${ci + 1}.${si + 1}`}
                    state={state}
                  />
                ))}
              </section>
            ))}
          </div>

          <div className="mt-48">
            <SectionHeading
              title="Flows"
              note="Each row is one flow. The black card names it, then the screens run left to right in the order they happen."
            />
          </div>
          <div className="flex flex-col gap-32">
            {FLOWS.map((flow, fi) => (
              <section key={flow.id} className="flex items-start gap-12">
                <RowCard label={`Flow ${fi + 1}`} name={flow.name} />
                {flow.screens.map((screen, si) => (
                  <FlowFrame
                    key={screen.title + (screen.annotation ?? "")}
                    id={`${fi + 1}.${si + 1}`}
                    flowId={flow.id}
                    index={si}
                    screen={screen}
                  />
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
