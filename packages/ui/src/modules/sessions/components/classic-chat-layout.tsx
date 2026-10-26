import { ArrowLeft } from "@carbon/icons-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
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
import { GettingStartedPanel } from "../../getting-started/components/getting-started-panel.js";
import { ApprovalsDrawer } from "../../home/components/approvals-panel.js";
import { MobileMenuButton } from "../../platform/components/sidebar/mobile-menu-button.js";
import { ProcessesPanel } from "../../processes/components/processes-panel.js";
import {
  type SidebarPanelStack,
  useSidebarPanels,
} from "../hooks/use-sidebar-panels.js";
import {
  clampLeftWidth,
  classicColumns,
  type ClassicPanel,
  LEFT_MIN_W,
  PANEL_MIN_W,
} from "../lib/classic-chat-layout.js";
import type { SidebarPanelId } from "../lib/sidebar-panels.js";
import { SidePanelCloseScope } from "./side-panel-close-button.js";
import { SidePanelEdgeTab } from "./side-panel-edge-tab.js";

const LEFT_WIDTH_KEY = "platform-left-w";
const FILE_PANEL_WIDTH_KEY = "platform-file-w";

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
 * UNIT_BOUNDARY_DESCRIPTION: The chat view's layout while the new-layout
 * experiment is off, as it was before the side panel and its icon bar: a top
 * bar with the Agent's identity and status, a resizable column of Files,
 * Artifacts and Processes sections on the left, the conversation in the
 * middle, and the docked item on the right, beside the conversation. Get
 * started opens in that right-hand slot from the top bar and hides the docked
 * item without closing it; Approvals opens as a drawer over the chat, so the
 * slot keeps whatever it shows.
 */
export function ClassicChatLayout({
  identity,
  status,
  notices,
  agentId,
  agentName,
  alwaysOn,
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
  notices: ReactNode;
  agentId: string | null;
  agentName: string | null;
  alwaysOn: boolean;
  processesEnabled: boolean;
  onOpenFile: (path: string, opts?: { edit?: boolean }) => void;
  panel: ClassicPanel | null;
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

  const [leftW, setLeftW] = useState(() =>
    clampLeftWidth(readPersistedNumber(LEFT_WIDTH_KEY, LEFT_MIN_W)),
  );
  const leftWRef = useRef(leftW);
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
  const panelStack = useSidebarPanels([
    { id: "files", open: filesSectionOpen },
    { id: "artifacts", open: artifactsSectionOpen },
    ...(processesEnabled
      ? [{ id: "processes" as const, open: processesSectionOpen }]
      : []),
  ]);

  const maximized = maximizable !== null && sidePanelMaximized === maximizable;
  const { panelFills, panelMaxW, panelW } = classicColumns({
    columnsW,
    leftW,
    savedPanelW: rightW,
    panelOpen: panel !== null,
    panelMaximized: maximized,
  });
  const leftPanelWidth = { width: leftW };

  return (
    <>
      <header
        className={`${mobileScreen === "files" ? "hidden md:flex" : "flex"} items-stretch h-[70px] max-md:h-[52px] max-md:border-b border-border shrink-0 relative z-content`}
      >
        <div
          style={leftPanelWidth}
          className="@container flex min-w-0 shrink-0 items-center gap-3 overflow-hidden px-4 max-md:!w-auto max-md:flex-1 md:border-r md:border-b md:border-border"
        >
          <MobileMenuButton />
          {identity}
        </div>
        <div className="ml-auto flex items-center gap-2 pl-2 pr-4 md:pl-6 md:pr-6">
          {status}
        </div>
      </header>

      <div ref={setColumnsEl} className="flex flex-1 min-h-0">
        <div
          style={leftPanelWidth}
          data-testid="chat-sections"
          className={cn(
            "shrink-0 flex flex-col border-r border-border overflow-hidden relative z-content",
            mobileScreen === "chat" ? "hidden md:flex" : "flex",
            mobileScreen === "files" && "max-md:!w-full",
            maximized && "md:!hidden",
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
          {desktop && notices}
          <SidePanelCloseScope value={false}>
            <FilesPanel
              open={filesSectionOpen}
              onToggle={() => setFilesSectionOpen(!filesSectionOpen)}
              {...panelStack.panelProps("files")}
              onOpenFile={onOpenFile}
            />
            <PanelDivider stack={panelStack} below="artifacts" />
            <ChatArtifactsPanel
              key={agentId}
              agentId={agentId}
              open={artifactsSectionOpen}
              onToggle={() => setArtifactsSectionOpen(!artifactsSectionOpen)}
              {...panelStack.panelProps("artifacts")}
            />
            {processesEnabled && (
              <>
                <PanelDivider stack={panelStack} below="processes" />
                <ProcessesPanel
                  agentId={agentId}
                  alwaysOn={alwaysOn}
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
        {!maximized && (
          <ResizeHandle
            side="left"
            label="Resize sections"
            onResize={(d) => {
              const v = clampLeftWidth(leftWRef.current + d);
              leftWRef.current = v;
              writePersistedNumber(LEFT_WIDTH_KEY, v);
              setLeftW(v);
            }}
          />
        )}

        <div
          className={cn(
            "@container/chat relative flex flex-1 flex-col min-w-0",
            mobileScreen === "files" ? "hidden md:flex" : "flex",
            panelFills && "md:!hidden",
          )}
        >
          {!desktop && notices}
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
              "flex flex-col bg-background relative z-content has-[[data-full-page]]:z-overlay max-md:fixed max-md:inset-0 max-md:z-overlay",
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
            {panel === "getting-started" && (
              <GettingStartedPanel className="flex-1" />
            )}
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
