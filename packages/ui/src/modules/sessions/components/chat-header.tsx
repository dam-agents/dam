import {
  OverflowMenuVertical as MoreVertical,
  Play,
  Renew as RotateCw,
  TrashCan,
} from "@carbon/icons-react";
import { ArrowLeft, MessageSquare, Settings2, Terminal } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import type { AgentView } from "../../../types.js";

interface ChatHeaderProps {
  agentName: string;
  selectedAgent: string | null;
  agents: AgentView[];
  busy: boolean;
  agentDisplay: {
    powerAction: "start" | "restart" | null;
  } | null;
  viewMode: "chat" | "terminal";
  onViewModeChange: (mode: "chat" | "terminal") => void;
  onBack: () => void;
  onMobilePanel: () => void;
  onStart: () => void;
  onRestart: () => void;
  onConfigure: () => void;
  onDelete: () => void;
  onToggleSetup: () => void;
  sessionNavTrigger?: ReactNode;
}

export function ChatHeader({
  agentName,
  selectedAgent,
  agents,
  busy,
  agentDisplay,
  viewMode,
  onViewModeChange,
  onBack,
  onMobilePanel,
  onStart,
  onRestart,
  onConfigure,
  onDelete,
  onToggleSetup,
  sessionNavTrigger,
}: ChatHeaderProps) {
  const agent = agents.find((a) => a.id === selectedAgent);
  const state = agent?.state ?? "starting";

  return (
    <header className="relative flex items-center gap-4 px-4 h-14 border-b border-border bg-white shrink-0">
      <button
        className="md:hidden flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground transition-colors"
        onClick={onBack}
      >
        <ArrowLeft size={16} />
      </button>

      {/* Sandbox name — hoverable with overflow menu appearing on hover */}
      <div className="group/name flex items-center gap-1 min-w-0 rounded-lg px-3 py-1.5 -ml-3 hover:bg-muted/50 transition-colors">
        <button
          onClick={onToggleSetup}
          className="flex items-center gap-2.5 min-w-0"
          title="Toggle sandbox details"
        >
          <span
            className="relative h-2.5 w-2.5 rounded-full shrink-0"
            title={busy ? "Busy" : state}
          >
            <span
              className={`absolute inset-0 rounded-full ${
                busy
                  ? "bg-primary anim-pulse"
                  : state === "running"
                    ? "bg-emerald-400"
                    : state === "hibernated"
                      ? "bg-muted-foreground/40"
                      : "bg-amber-400"
              }`}
            />
          </span>
          <h1 className="text-[16px] font-semibold text-foreground truncate">
            {agentName}
          </h1>
        </button>

        {/* Overflow menu — only visible on hover */}
        {selectedAgent && agentDisplay && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground opacity-0 group-hover/name:opacity-100 transition-opacity"
              >
                <MoreVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                disabled={agentDisplay.powerAction === null}
                onClick={() => {
                  if (agentDisplay.powerAction === "start") onStart();
                  else if (agentDisplay.powerAction === "restart") onRestart();
                }}
              >
                {agentDisplay.powerAction === "start" ? (
                  <>
                    <Play /> Start
                  </>
                ) : (
                  <>
                    <RotateCw /> Restart
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onConfigure}>
                <Settings2 size={16} /> Configure
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={onDelete}
              >
                <TrashCan /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {sessionNavTrigger}

      {/* Chat / Terminal toggle — centered */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center h-8 rounded-lg bg-muted/60 p-0.5">
        <button
          type="button"
          onClick={() => onViewModeChange("chat")}
          className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium transition-all ${
            viewMode === "chat"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <MessageSquare size={13} />
          Chat
        </button>
        <button
          type="button"
          onClick={() => onViewModeChange("terminal")}
          className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-[12px] font-medium transition-all ${
            viewMode === "terminal"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Terminal size={13} />
          Terminal
        </button>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          className="md:hidden h-8 w-8 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          onClick={onMobilePanel}
        >
          <Settings2 size={14} />
        </button>
      </div>
    </header>
  );
}
