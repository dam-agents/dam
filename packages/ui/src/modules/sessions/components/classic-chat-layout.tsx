import { ArrowLeft } from "@carbon/icons-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import { useIsDesktop } from "@/hooks/use-is-desktop";
import { cn } from "@/lib/utils";

import { ResizeHandle } from "../../../components/resize-handle.js";
import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import { useStore } from "../../../store.js";
import { ChatArtifactsPanel } from "../../artifacts/components/chat-artifacts-panel.js";
import { FilesPanel } from "../../files/components/files-panel.js";
import { ApprovalsDrawer } from "../../home/components/approvals-panel.js";
import { MobileMenuButton } from "../../platform/components/sidebar/mobile-menu-button.js";
import { ProcessesPanel } from "../../processes/components/processes-panel.js";
import { useChatSections } from "../hooks/use-chat-sections.js";
import {
  type SidebarPanelStack,
  useSidebarPanels,
} from "../hooks/use-sidebar-panels.js";
import {
  classicColumns,
  headerFlanks,
  PANEL_MIN_W,
  sectionsColumn,
} from "../lib/classic-chat-layout.js";
import type { SidebarPanel, SidebarPanelId } from "../lib/sidebar-panels.js";
import { ChatColumn } from "./chat-column.js";
import { SidePanelCloseScope } from "./side-panel-close-button.js";
import { SidePanelEdgeTab } from "./side-panel-edge-tab.js";

const FILE_PANEL_WIDTH_KEY = "platform-file-w";
/* UNIT_BOUNDARY_DESCRIPTION: the sections column's width, fixed, as the design draws it. */
const SECTIONS_W = 320;

/* UNIT_BOUNDARY_DESCRIPTION: an element's width with nothing in it cut short: a name truncated with an ellipsis counts at its full length, so the header measures the same in either layout and does not flip between them. */
function naturalWidth(el: HTMLElement): number {
  let width = el.getBoundingClientRect().width;
  for (const child of el.querySelectorAll<HTMLElement>("*")) {
    const cut = child.scrollWidth - child.clientWidth;
    if (cut > 0 && getComputedStyle(child).overflowX !== "visible")
      width += cut;
  }
  return width;
}

/* UNIT_BOUNDARY_DESCRIPTION: whether the chat header's start and end fit beside the messages' well, measured again whenever the header or either of them changes size. */
function useHeaderFlanks() {
  const headerRef = useRef<HTMLElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const [flanks, setFlanks] = useState(true);
  useLayoutEffect(() => {
    const header = headerRef.current;
    const start = startRef.current;
    const end = endRef.current;
    if (!header || !start || !end) return;
    const measure = () =>
      setFlanks(
        headerFlanks({
          headerW: header.getBoundingClientRect().width,
          startW: naturalWidth(start),
          endW: naturalWidth(end),
        }),
      );
    measure();
    const ro = new ResizeObserver(measure);
    for (const el of [header, start, end]) ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { flanks, headerRef, startRef, endRef };
}

function PanelDivider({
  stack,
  below,
}: {
  stack: SidebarPanelStack;
  below: SidebarPanelId;
}) {
  const divider = stack.dividerProps(below);
  return divider && <ResizeHandle orientation="vertical" {...divider} />;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The chat view's layout, as the design's chat
 * refresh draws it: a thin strip across the top with the notifications bell,
 * then the open Files and Artifacts in a 320 px column on the left, stacked
 * when both are open, the conversation with its own header (the agent menu and
 * the Agent's status) in the middle, and the docked item on the right, beside
 * the conversation. The strip's border shows while anything is open beside
 * the conversation. A phone keeps the sections, Processes too, in a screen of
 * their own, each folding from its header, and the bell in the header. The
 * bell is drawn once, in one place or the other.
 * Approvals opens as a drawer over the chat, so the slot keeps whatever it
 * shows.
 */
export function ClassicChatLayout({
  identity,
  status,
  newChat,
  activity,
  notices,
  agentId,
  agentName,
  processesEnabled,
  onOpenFile,
  panel,
  dockHiddenOnPhone,
  dock,
  maximizable,
  onClosePanel,
  children,
}: {
  identity: ReactNode;
  status: ReactNode;
  /** UNIT_BOUNDARY_DESCRIPTION: the header's New chat button, at its end, as the design draws it; always there for an Agent, so the header keeps its balance, and on a chat not started yet it only puts the cursor in the composer. */
  newChat?: ReactNode;
  activity: ReactNode;
  notices: ReactNode;
  agentId: string | null;
  agentName: string | null;
  processesEnabled: boolean;
  onOpenFile: (path: string, opts?: { edit?: boolean }) => void;
  panel: "dock" | null;
  dockHiddenOnPhone: boolean;
  dock: ReactNode;
  maximizable: string | null;
  onClosePanel: () => void;
  children: ReactNode;
}) {
  const mobileScreen = useStore((s) => s.mobileScreen);
  const desktop = useIsDesktop();
  const setMobileScreen = useStore((s) => s.setMobileScreen);
  const filesSectionOpen = useStore((s) => s.filesSectionOpen);
  const setFilesSectionOpen = useStore((s) => s.setFilesSectionOpen);
  const artifactsSectionOpen = useStore((s) => s.artifactsSectionOpen);
  const setArtifactsSectionOpen = useStore((s) => s.setArtifactsSectionOpen);
  const processesSectionOpen = useStore((s) => s.processesSectionOpen);
  const setProcessesSectionOpen = useStore((s) => s.setProcessesSectionOpen);
  const sidePanelMaximized = useStore((s) => s.sidePanelMaximized);
  const setSidePanelMaximized = useStore((s) => s.setSidePanelMaximized);
  const sidePanelTab = useStore((s) => s.sidePanelTab);
  const setSidePanelTab = useStore((s) => s.setSidePanelTab);

  const [rightW, setRightW] = useState<number | null>(() =>
    readPersistedNumber(FILE_PANEL_WIDTH_KEY, null),
  );
  const rightWRef = useRef(rightW);
  const [columnsEl, setColumnsEl] = useState<HTMLDivElement | null>(null);
  const [columnsW, setColumnsW] = useState<number | null>(null);
  useEffect(() => {
    if (!columnsEl) return;
    const ro = new ResizeObserver(([entry]) =>
      setColumnsW(entry.contentRect.width),
    );
    ro.observe(columnsEl);
    return () => ro.disconnect();
  }, [columnsEl]);
  const panelRef = useRef<HTMLDivElement>(null);
  const sections: SidebarPanel[] = useChatSections().map(({ id, open }) => ({
    id,
    open,
  }));
  const phoneProcesses = !desktop && processesEnabled;
  const panelStack = useSidebarPanels([
    ...sections,
    ...(phoneProcesses
      ? [{ id: "processes" as const, open: processesSectionOpen }]
      : []),
  ]);
  const column = sectionsColumn(sections, desktop);
  const shows = (id: SidebarPanelId) => column.shown.includes(id);
  const sectionControls = (open: boolean, setOpen: (open: boolean) => void) =>
    desktop
      ? { onClose: () => setOpen(false) }
      : { onToggle: () => setOpen(!open) };

  const maximized = maximizable !== null && sidePanelMaximized === maximizable;
  const { panelFills, panelMaxW, panelW } = classicColumns({
    columnsW,
    leftW: column.open ? SECTIONS_W : 0,
    savedPanelW: rightW,
    panelOpen: panel !== null,
    panelMaximized: maximized,
  });
  const anythingOpen = column.open || panel !== null;
  const header = useHeaderFlanks();

  return (
    <>
      <div
        data-testid="chat-top-strip"
        className={cn(
          "hidden h-10 shrink-0 items-center justify-end border-b px-6 transition-colors duration-200 md:flex",
          anythingOpen ? "border-border" : "border-transparent",
        )}
      >
        {desktop && activity}
      </div>

      <div ref={setColumnsEl} className="flex flex-1 min-h-0">
        <div
          data-testid="chat-sections"
          className={cn(
            "shrink-0 flex flex-col overflow-hidden relative z-content md:w-[320px] md:border-r md:border-border",
            mobileScreen === "chat" ? "hidden md:flex" : "flex",
            mobileScreen === "files" && "max-md:!w-full",
            (maximized || !column.open) && "md:!hidden",
          )}
        >
          <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Back to chat"
              onClick={() => setMobileScreen("chat")}
            >
              <ArrowLeft size={16} />
            </Button>
            <span className="truncate text-sm font-bold text-foreground">
              {agentName}
            </span>
          </div>
          {desktop && column.open && notices}
          <SidePanelCloseScope value={false}>
            {shows("files") && (
              <FilesPanel
                open={filesSectionOpen}
                {...sectionControls(filesSectionOpen, setFilesSectionOpen)}
                {...panelStack.panelProps("files")}
                onOpenFile={onOpenFile}
              />
            )}
            {shows("artifacts") && (
              <>
                <PanelDivider stack={panelStack} below="artifacts" />
                <ChatArtifactsPanel
                  key={agentId}
                  agentId={agentId}
                  open={artifactsSectionOpen}
                  {...sectionControls(
                    artifactsSectionOpen,
                    setArtifactsSectionOpen,
                  )}
                  {...panelStack.panelProps("artifacts")}
                />
              </>
            )}
            {phoneProcesses && (
              <>
                <PanelDivider stack={panelStack} below="processes" />
                <ProcessesPanel
                  agentId={agentId}
                  open={processesSectionOpen}
                  onToggle={() =>
                    setProcessesSectionOpen(!processesSectionOpen)
                  }
                  {...panelStack.panelProps("processes")}
                />
              </>
            )}
          </SidePanelCloseScope>
        </div>

        <div
          className={cn(
            "@container/chat relative flex flex-1 flex-col min-w-0",
            mobileScreen === "files" ? "hidden md:flex" : "flex",
            panelFills && "md:!hidden",
          )}
        >
          {/* UNIT_BOUNDARY_DESCRIPTION: the header flanks the content well, as the design review drew it: where the chat is wide enough, the agent menu's chevron ends 16 px outside the messages' left edge (the menu's hover padding reaches past it) and New chat starts 16 px outside their right edge (the well is the 813 px column less its 32 px padding, 749 px). A narrower chat has no room beside the well, nor has a wide one whose margin is narrower than the agent menu (a long name, the Shared badge), so there both sit inside it, at the messages' edges. The Agent's status is not part of that measure, so the layout stays as it is while the Agent runs and while it idles. */}
          <header
            ref={header.headerRef}
            data-flanks={header.flanks}
            className="relative z-content flex h-14 shrink-0 items-center max-md:h-[52px] max-md:border-b max-md:border-border max-md:px-3"
          >
            <ChatColumn
              className={cn(
                "flex items-center gap-2 max-md:px-0 md:px-2 md:@xs/chat:px-4 md:@xl/chat:px-8",
                header.flanks &&
                  "@5xl/chat:grid @5xl/chat:max-w-none @5xl/chat:grid-cols-[1fr_minmax(0,749px)_1fr] @5xl/chat:gap-x-4 @5xl/chat:!px-0",
              )}
            >
              <div
                ref={header.startRef}
                data-testid="chat-header-start"
                className={cn(
                  "flex min-w-0 items-center gap-2",
                  header.flanks &&
                    "@5xl/chat:col-start-1 @5xl/chat:-mr-2 @5xl/chat:justify-self-end",
                )}
              >
                <MobileMenuButton />
                {identity}
              </div>
              {/* UNIT_BOUNDARY_DESCRIPTION: the Agent's status — the running count and the badges — comes and goes as processes start and turns end, so it stays out of what the header measures: flanking, it opens the messages' column, beside the agent menu, and neither the menu nor the layout moves when it changes. */}
              <div
                data-testid="chat-header-status"
                className={cn(
                  "flex min-w-0 items-center gap-2 empty:hidden",
                  header.flanks &&
                    "@5xl/chat:col-start-2 @5xl/chat:justify-self-start",
                )}
              >
                {status}
              </div>
              <div
                ref={header.endRef}
                data-testid="chat-header-end"
                className={cn(
                  "ml-auto flex shrink-0 items-center gap-2",
                  header.flanks &&
                    "@5xl/chat:col-start-3 @5xl/chat:ml-0 @5xl/chat:justify-self-start",
                )}
              >
                {newChat}
                {!desktop && activity}
              </div>
            </ChatColumn>
          </header>
          {(!desktop || !column.open) && notices}
          {children}
        </div>

        {panel !== null && !panelFills && (
          <div className="hidden md:flex">
            <ResizeHandle
              side="right"
              label="Resize side panel"
              onResize={(d) => {
                const max = panelMaxW ?? window.innerWidth - 500;
                const base = Math.min(
                  rightWRef.current ?? panelRef.current?.offsetWidth ?? 0,
                  max,
                );
                const v = Math.max(PANEL_MIN_W, Math.min(max, base + d));
                rightWRef.current = v;
                writePersistedNumber(FILE_PANEL_WIDTH_KEY, v);
                setRightW(v);
              }}
            />
          </div>
        )}
        {(panel !== null || dock !== null) && (
          <div
            ref={panelRef}
            data-testid="classic-side-panel"
            style={
              panelW !== null
                ? ({ "--file-w": `${panelW}px` } as CSSProperties)
                : undefined
            }
            className={cn(
              "flex flex-col bg-background relative z-content max-md:fixed max-md:inset-0 max-md:z-overlay",
              panel === null && "hidden",
              panel === "dock" && dockHiddenOnPhone && "max-md:hidden",
              panelFills
                ? "md:flex-1 md:min-w-0"
                : panelW !== null
                  ? "md:shrink-0 md:w-[var(--file-w)]"
                  : "md:flex-1 md:basis-0 md:min-w-0",
              "md:border-l md:border-border",
            )}
          >
            <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-border px-3 md:hidden">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Back to chat"
                onClick={onClosePanel}
              >
                <ArrowLeft size={16} />
              </Button>
              <span className="truncate text-sm font-bold text-foreground">
                {agentName}
              </span>
            </div>
            <div
              className={cn(
                "flex flex-1 min-h-0 flex-col",
                panel !== "dock" && "hidden",
              )}
            >
              <SidePanelCloseScope value={false}>{dock}</SidePanelCloseScope>
            </div>
            {maximizable && (maximized || !panelFills) && (
              <SidePanelEdgeTab
                maximized={maximized}
                onToggle={() =>
                  setSidePanelMaximized(maximized ? null : maximizable)
                }
              />
            )}
          </div>
        )}
      </div>
      {sidePanelTab === "approvals" && (
        <ApprovalsDrawer onClose={() => setSidePanelTab(null)} />
      )}
    </>
  );
}
