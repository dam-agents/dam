import type { ReactNode } from "react";
import { useState } from "react";

import { ResizeHandle } from "../../../components/resize-handle.js";
import type { PanelSide } from "../../../store.js";

interface ChatLayoutProps {
  agentHeader: ReactNode;
  leftPanel: ReactNode;
  leftPanelOpen: boolean;
  panelSide: PanelSide;
  centerPanel: ReactNode;
  rightPanel: ReactNode | null;
  mobileScreen: "sessions" | "chat";
  showMobilePanel: boolean;
  onCloseMobilePanel: () => void;
}

export function ChatLayout({
  agentHeader,
  leftPanel,
  leftPanelOpen,
  panelSide,
  centerPanel,
  rightPanel,
  mobileScreen,
  showMobilePanel,
  onCloseMobilePanel,
}: ChatLayoutProps) {
  const [leftW, setLeftW] = useState(
    () => Number(localStorage.getItem("platform-setup-w")) || 340,
  );
  const [rightW, setRightW] = useState(
    () => Number(localStorage.getItem("platform-artifact-w")) || 380,
  );

  const panelElement = leftPanelOpen ? (
    <>
      <div
        style={{ width: leftW }}
        className={`shrink-0 flex flex-col border-border bg-card overflow-hidden relative z-10 ${
          panelSide === "left" ? "border-r" : "border-l"
        } ${
          mobileScreen === "chat" ? "hidden md:flex" : "flex"
        } ${mobileScreen === "sessions" ? "max-md:!w-full" : ""}`}
      >
        {leftPanel}
      </div>
      <ResizeHandle
        side={panelSide}
        onResize={(d) =>
          setLeftW((w) => {
            const delta = panelSide === "left" ? d : -d;
            const v = Math.max(260, Math.min(520, w + delta));
            localStorage.setItem("platform-setup-w", String(v));
            return v;
          })
        }
      />
    </>
  ) : null;

  return (
    <div className="flex flex-1 flex-col min-w-0 bg-background relative overflow-hidden">
      {agentHeader}

      <div className="flex flex-1 min-w-0 min-h-0 relative">
        {/* Panel on left side */}
        {panelSide === "left" && panelElement}

        {/* Center: Chat */}
        <div
          className={`relative flex flex-1 flex-col min-w-0 ${mobileScreen === "sessions" ? "hidden md:flex" : "flex"}`}
        >
          {centerPanel}
        </div>

        {/* Panel on right side */}
        {panelSide === "right" && panelElement}

        {/* Right: Artifact Panel (contextual) */}
        {rightPanel && (
          <>
            <ResizeHandle
              side="right"
              onResize={(d) =>
                setRightW((w) => {
                  const v = Math.max(240, Math.min(600, w + d));
                  localStorage.setItem("platform-artifact-w", String(v));
                  return v;
                })
              }
            />
            <div
              style={{ width: rightW }}
              className="hidden md:flex shrink-0 flex-col border-l border-border bg-card overflow-hidden relative z-10"
            >
              {rightPanel}
            </div>
          </>
        )}

        {/* Mobile overlay for right panel */}
        {showMobilePanel && rightPanel && (
          <div className="md:hidden fixed inset-0 z-50 flex">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={onCloseMobilePanel}
            />
            <div className="absolute right-0 top-0 bottom-0 w-full max-w-[400px] bg-card flex flex-col anim-slide-in-right">
              {rightPanel}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
