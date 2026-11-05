import {
  Calendar,
  Launch,
  Locked,
  TrashCan,
  UserMultiple,
} from "@carbon/icons-react";
import type { EnvironmentView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { HintTooltip, Tooltip } from "@/components/ui/tooltip";
import { treeIndent } from "@/components/ui/tree-guide";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { AgentAvatar } from "../../agents/components/avatar/agent-avatar.js";
import { ArtifactDeletionChip } from "../../artifacts/components/artifact-badges.js";
import { useDeleteEnvironment } from "../api/mutations.js";
import { environmentStateLabel, NEVER_DELETED } from "../lib/environment-list.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One Environment as a row of the Artifacts list,
 * shaped like an artifact's: the sharing icon that opens its Share dialog,
 * its name, whether it runs, when it is deleted or that it never is, its agent, and a link that
 * opens its first address in a new tab. With more than one address, the
 * row's menu opens each of them, so the links never crowd out the name. The
 * menu also sets its expiry and deletes it. The icon says whether anyone beyond the owner and the agent's editors
 * may open it; an Environment is never public.
 */
export function EnvironmentRow({
  environment,
  depth,
  showAgent,
  onShare,
  onSetExpiry,
}: {
  environment: EnvironmentView;
  depth: number;
  showAgent: boolean;
  onShare: (environment: EnvironmentView) => void;
  onSetExpiry: (environment: EnvironmentView) => void;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const remove = useDeleteEnvironment();
  const running = environment.state === "running";
  const links = environment.endpoints.filter((e) => e.url !== null);
  const [inline] = links;
  const shared =
    environment.members.length > 0 || environment.agentMemberCount > 0;
  const shareLabel = shared
    ? "Shared with people you chose"
    : "Only you and the agent's editors";
  const ShareIcon = shared ? UserMultiple : Locked;

  const handleDelete = async () => {
    if (
      await showConfirm(
        "Its machine and disk are deleted, and its addresses stop answering. The agent can create it again.",
        `Delete Environment “${environment.name}”?`,
        { kind: "destructive", confirmLabel: "Delete Environment" },
      )
    )
      remove.mutate({ id: environment.id });
  };

  return (
    <div
      title={environment.name}
      className="group flex h-8 w-full items-center gap-1.5 pr-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
      style={{ paddingLeft: treeIndent(depth) }}
      data-testid="environment-row"
      data-environment={environment.name}
    >
      <Button
        variant="ghost"
        size="icon-sm"
        className="-mx-1.5 shrink-0"
        aria-haspopup="dialog"
        aria-label={`Share ${environment.name} — ${shareLabel.toLowerCase()}`}
        tooltip={shareLabel}
        onClick={() => onShare(environment)}
      >
        <ShareIcon size={16} />
      </Button>
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <span className="min-w-12 shrink-[100000] truncate">
          {environment.name}
        </span>
        <Badge
          size="sm"
          variant={running ? "success" : "muted"}
          className="h-4 shrink-0 py-0 leading-none"
          data-testid="environment-state"
        >
          {environmentStateLabel(environment.state)}
        </Badge>
        {environment.expiresAt ? (
          <ArtifactDeletionChip
            expiresAt={environment.expiresAt}
            className="text-xs text-muted-foreground"
          />
        ) : (
          <HintTooltip
            label={NEVER_DELETED}
            content={NEVER_DELETED}
            className="shrink-0 gap-1 whitespace-nowrap text-xs text-muted-foreground"
          >
            <Calendar size={12} />
            never
          </HintTooltip>
        )}
      </div>
      {showAgent && <AgentByline agentId={environment.owningAgentId} />}
      {inline && (
        <Tooltip content={inline.url}>
          <a
            href={inline.url!}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${inline.name} of ${environment.name}`}
            data-testid="environment-link"
            className="flex h-6 max-w-24 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-background hover:text-accent"
          >
            {links.length > 1 && (
              <span className="truncate">{inline.name}</span>
            )}
            <Launch size={12} aria-hidden className="shrink-0" />
          </a>
        </Tooltip>
      )}
      <div className="shrink-0">
        <RowActionsMenu
          label={`Actions for ${environment.name}`}
          testId="environment-actions"
          dense
          className={HOVER_ACTION}
          disabled={remove.isPending}
        >
          {links.length > 1 && (
            <>
              {links.map((endpoint) => (
                <DropdownMenuItem key={endpoint.name} asChild>
                  <a
                    href={endpoint.url!}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="environment-menu-link"
                  >
                    <Launch size={14} />
                    Open {endpoint.name}
                  </a>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem onSelect={() => onShare(environment)}>
            <UserMultiple size={14} />
            Share
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => onSetExpiry(environment)}>
            <Calendar size={14} />
            Set expiration
          </DropdownMenuItem>
          <DropdownMenuItem tone="danger" onSelect={() => void handleDelete()}>
            <TrashCan size={14} />
            Delete Environment
          </DropdownMenuItem>
        </RowActionsMenu>
      </div>
    </div>
  );
}

function AgentByline({ agentId }: { agentId: string }) {
  const selectAgent = useStore((s) => s.selectAgent);
  const agent = useAgentsList().find((a) => a.id === agentId);
  if (!agent) return null;
  return (
    <Tooltip content={`Open ${agent.name}`}>
      <button
        type="button"
        aria-label={`Open ${agent.name}`}
        onClick={() => selectAgent(agentId)}
        className={cn(
          "inline-flex max-w-28 min-w-0 shrink-0 items-center gap-1 text-xs transition-colors hover:text-accent",
        )}
      >
        <AgentAvatar
          name={agent.name}
          avatar={agent.avatar}
          size={14}
          className="shrink-0"
        />
        <span className="truncate">{agent.name}</span>
      </button>
    </Tooltip>
  );
}
