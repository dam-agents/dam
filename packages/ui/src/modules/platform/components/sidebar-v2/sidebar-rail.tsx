import { Add, ChevronRight, Home, Pin, Settings } from "@carbon/icons-react";
import { useState } from "react";

import { FOCUS_RING } from "@/components/ui/focus-ring";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.js";
import { railTile } from "@/components/ui/rail-tile";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../../store.js";
import type { AgentView } from "../../../../types.js";
import {
  AgentAvatar,
  avatarMood,
} from "../../../agents/components/avatar/agent-avatar.js";
import { useSidebarAgents } from "../../../agents/hooks/use-sidebar-agents.js";
import { useApprovalsForOwner } from "../../../approvals/api/queries.js";
import { useStartSession } from "../../../sessions/hooks/use-start-session.js";
import { usePinnedSessions } from "../../../sessions/lib/pinned-sessions.js";
import { awaitsApproval } from "../../lib/sidebar-tree.js";
import { AddRow } from "./add-row.js";
import { AgentSessionList } from "./agent-session-list.js";
import { PinnedList } from "./pinned-rows.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: JanUI's sidebar as one column of icons, which it becomes when it is collapsed: Home, the Pinned section, one avatar per Agent in the same manual order and Settings. An avatar or the pin icon opens what the expanded tree would show under it, in a popover beside the rail, and choosing a Session closes it. The rail never leaves the layout, so the page always has a way back to the tree.
 */
export function SidebarRail({
  onExpand,
  onNavigate,
}: {
  onExpand: () => void;
  onNavigate?: () => void;
}) {
  const { agents, openAgentId, unreadAgentIds } = useSidebarAgents();
  const approvals = useApprovalsForOwner().data;
  const pins = usePinnedSessions();
  const homeOpen = useStore((s) => s.view === "home");
  const settingsOpen = useStore((s) => s.view === "settings");
  const setView = useStore((s) => s.setView);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const [open, setOpen] = useState<string | null>(null);
  const close = () => setOpen(null);
  const navigate = () => {
    close();
    onNavigate?.();
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-x-visible overflow-y-auto py-2"
      data-testid="sidebar-rail"
    >
      <Tooltip content="Expand navigation" side="right">
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand navigation"
          data-testid="sidebar-rail-expand"
          className={cn(railTile(false), FOCUS_RING)}
        >
          <ChevronRight size={18} />
        </button>
      </Tooltip>
      <Tooltip content="Home" side="right">
        <button
          type="button"
          onClick={() => {
            setView("home");
            navigate();
          }}
          aria-label="Home"
          aria-current={homeOpen ? "page" : undefined}
          data-testid="sidebar-home-row"
          className={cn(railTile(homeOpen), FOCUS_RING)}
        >
          <Home size={20} />
        </button>
      </Tooltip>
      {pins.size > 0 && (
        <Popover
          open={open === "pinned"}
          onOpenChange={(next) => setOpen(next ? "pinned" : null)}
        >
          <Tooltip content="Pinned sessions" side="right">
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Pinned sessions"
                aria-current={open === "pinned" ? "page" : undefined}
                data-testid="sidebar-rail-pinned"
                className={cn(railTile(open === "pinned"), FOCUS_RING)}
              >
                <Pin size={20} />
              </button>
            </PopoverTrigger>
          </Tooltip>
          <PopoverContent
            side="right"
            align="start"
            className="max-h-[70vh] w-[320px] overflow-y-auto p-2"
          >
            <div className="px-2 pb-1 text-xs font-semibold text-muted-foreground">
              Pinned
            </div>
            <div className="flex flex-col gap-px">
              <PinnedList onNavigate={navigate} />
            </div>
          </PopoverContent>
        </Popover>
      )}
      <div aria-hidden className="my-1 h-px w-6 shrink-0 bg-border" />
      <div
        className="flex min-h-0 flex-col items-center gap-0.5"
        data-testid="sidebar-rail-agents"
      >
        {agents.map((agent) => (
          <AgentTile
            key={agent.id}
            agent={agent}
            current={agent.id === openAgentId}
            cue={
              awaitsApproval(approvals ?? [], agent.id)
                ? "approval"
                : unreadAgentIds.has(agent.id)
                  ? "unread"
                  : null
            }
            open={open === agent.id}
            onOpenChange={(next) => setOpen(next ? agent.id : null)}
            onNavigate={navigate}
          />
        ))}
      </div>
      <Tooltip content="Settings" side="right">
        <button
          type="button"
          onClick={() => {
            navigateToSettings();
            navigate();
          }}
          aria-label="Settings"
          aria-current={settingsOpen ? "page" : undefined}
          data-testid="sidebar-settings-row"
          className={cn(railTile(settingsOpen), "mt-auto", FOCUS_RING)}
        >
          <Settings size={20} />
        </button>
      </Tooltip>
    </div>
  );
}

function AgentTile({
  agent,
  current,
  cue,
  open,
  onOpenChange,
  onNavigate,
}: {
  agent: AgentView;
  current: boolean;
  cue: "approval" | "unread" | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: () => void;
}) {
  const startSession = useStartSession();
  const name = cue
    ? `${agent.name}, ${cue === "approval" ? "needs your approval" : "unread"}`
    : agent.name;
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip content={agent.name} side="right">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={name}
            aria-current={open ? "page" : undefined}
            data-testid="sidebar-rail-agent"
            data-agent-id={agent.id}
            className={cn(railTile(current || open), FOCUS_RING)}
          >
            <AgentAvatar
              name={agent.name}
              avatar={agent.avatar}
              size={26}
              mood={avatarMood(agent.state, agent)}
            />
            {cue && (
              <span
                aria-hidden
                className={cn(
                  "absolute top-0.5 right-0.5 size-2 rounded-full ring-2 ring-chrome",
                  cue === "approval" ? "bg-warning" : "bg-success",
                )}
              />
            )}
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        side="right"
        align="start"
        className="max-h-[70vh] w-[320px] overflow-y-auto p-2"
      >
        <div className="truncate px-2 pb-1 text-sm font-medium">
          {agent.name}
        </div>
        <AgentSessionList
          agentId={agent.id}
          onNavigate={onNavigate}
          newSessionRow={
            <AddRow
              icon={Add}
              label="New session"
              ariaLabel={`New session with ${agent.name}`}
              testId="sidebar-new-session-row"
              onClick={() => {
                onNavigate();
                startSession(agent.id);
              }}
            />
          }
        />
      </PopoverContent>
    </Popover>
  );
}
