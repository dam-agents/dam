import { Add, AddComment, Tools } from "@carbon/icons-react";
import { type ReactNode, useMemo, useState } from "react";

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { useActivityConversations } from "../../home/hooks/use-activity-conversations.js";
import { useActivitySessions } from "../../home/hooks/use-activity-sessions.js";
import { useDefaultModelNotices } from "../../home/hooks/use-default-model-notices.js";
import { defaultModelStopsRuns } from "../../home/lib/default-model-copy.js";
import { MessengerBindDialog } from "../../sandboxes/components/channels/messenger-bind-dialog.js";
import type { BindMessenger } from "../../sandboxes/components/channels/messenger-instructions.js";
import { SidebarAgentSessions } from "../../sessions/components/sidebar-agent-sessions.js";
import { useStartSession } from "../../sessions/hooks/use-start-session.js";
import { useAgents, useAgentsList } from "../api/queries.js";
import { useCreateDefaultAgent } from "../hooks/use-create-default-agent.js";
import { useSidebarAgents } from "../hooks/use-sidebar-agents.js";
import { useSidebarOrderActions } from "../hooks/use-sidebar-order-actions.js";
import { SidebarAgentRow } from "./sidebar-agent-row.js";

export function SidebarAgents({
  stickyHeaderClassName,
  onNavigate,
}: {
  stickyHeaderClassName: string;
  onNavigate?: () => void;
}) {
  const {
    agents,
    active,
    folded,
    openAgentId,
    isOpen,
    sessionOpen,
    unreadAgentIds,
    sessionsOf,
    previewComplete,
  } = useSidebarAgents();
  const orderActions = useSidebarOrderActions();
  const defaultModels = useDefaultModelNotices();
  const activity = useActivitySessions();
  const allAgents = useAgentsList();
  const attention = useMemo(
    () => activity.items.map((item) => item.session),
    [activity.items],
  );
  const conversationOf = useActivityConversations(attention, allAgents);
  const available = useAgents().data?.availableChannels ?? {};
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const setAgentOpen = useStore((s) => s.setSidebarAgentOpen);
  const showFolded = useStore((s) => s.sidebarShowHibernating);
  const setShowFolded = useStore((s) => s.setSidebarShowHibernating);
  const startSession = useStartSession();
  const [binding, setBinding] = useState<BindMessenger | null>(null);

  const navigate = (go: () => void) => () => {
    go();
    onNavigate?.();
  };

  const shownAgents = showFolded ? agents : active;
  const shownAgentIds = shownAgents.map((agent) => agent.id);
  const row = (agent: AgentView) => {
    const current = agent.id === openAgentId;
    const open = isOpen(agent.id);
    return (
      <SidebarAgentRow
        key={agent.id}
        agent={agent}
        open={open}
        selected={current}
        current={current && !sessionOpen}
        unread={unreadAgentIds.has(agent.id)}
        noDefaultModel={defaultModelStopsRuns(
          defaultModels.byAgentEvenDismissed.get(agent.id),
        )}
        orderReady={orderActions.ready}
        onMove={(id, drop) => orderActions.moveAgent(shownAgentIds, id, drop)}
        onStep={(id, step) => orderActions.stepAgent(shownAgentIds, id, step)}
        onSelect={() => setAgentOpen(agent.id, !open)}
        actions={
          <>
            <RowIconButton
              label="New session"
              onClick={navigate(() => startSession(agent.id))}
            >
              <AddComment size={14} />
            </RowIconButton>
            <RowActionsMenu
              label="Agent actions"
              testId="sidebar-agent-menu"
              dense
              stopPropagation
            >
              <DropdownMenuItem
                onSelect={navigate(() => navigateToSandboxHome(agent.id))}
              >
                <Tools size={14} /> Configure agent
              </DropdownMenuItem>
              {(available.slack || available.telegram) && (
                <DropdownMenuSeparator />
              )}
              {available.slack && (
                <DropdownMenuItem onSelect={() => setBinding("slack")}>
                  <ConnectionIcon iconSlug="slack" alt="" size={14} />
                  Add to Slack channel
                </DropdownMenuItem>
              )}
              {available.telegram && (
                <DropdownMenuItem onSelect={() => setBinding("telegram")}>
                  <ConnectionIcon iconSlug="telegram" alt="" size={14} />
                  Add to Telegram chat
                </DropdownMenuItem>
              )}
            </RowActionsMenu>
          </>
        }
      >
        <SidebarAgentSessions
          agentId={agent.id}
          open={current}
          shown={open}
          preview={sessionsOf(agent.id)}
          previewComplete={previewComplete}
          conversationOf={conversationOf}
          stickyClassName={stickyHeaderClassName}
          onNavigate={onNavigate}
        />
      </SidebarAgentRow>
    );
  };

  return (
    <section aria-label="Agents" data-testid="sidebar-agents">
      <div
        className={cn(
          "sticky top-0 z-raised flex items-center justify-between py-1 pr-1 pl-2.5",
          stickyHeaderClassName,
        )}
      >
        <SectionLabel>Agents</SectionLabel>
        <CreateAgentButton onCreate={onNavigate} />
      </div>
      {activity.unreadable && (
        <p className="px-2.5 py-1.5 text-xs text-muted-foreground">
          Recent sessions can't be loaded right now.
        </p>
      )}
      <ul className="flex flex-col gap-px">{shownAgents.map(row)}</ul>
      {folded.length > 0 && (
        <button
          type="button"
          onClick={() => setShowFolded(!showFolded)}
          aria-expanded={showFolded}
          data-testid="sidebar-agents-hibernating"
          className="mt-px flex h-[30px] w-full items-center rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {showFolded ? "Show less" : `See all (${folded.length} hibernating)`}
        </button>
      )}
      {binding && (
        <MessengerBindDialog
          messenger={binding}
          onClose={() => setBinding(null)}
        />
      )}
    </section>
  );
}

function RowIconButton({
  label,
  disabled = false,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function CreateAgentButton({ onCreate }: { onCreate?: () => void }) {
  const defaultAgent = useCreateDefaultAgent();
  return (
    <Tooltip content="Create agent" side="right">
      <button
        type="button"
        aria-label="Create agent"
        disabled={!defaultAgent.ready}
        onClick={() => {
          void defaultAgent.create();
          onCreate?.();
        }}
        className="flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <Add size={14} />
      </button>
    </Tooltip>
  );
}
