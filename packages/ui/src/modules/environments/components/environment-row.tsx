import {
  Asleep,
  Awake,
  Calendar,
  Launch,
  Locked,
  TrashCan,
  UserMultiple,
} from "@carbon/icons-react";
import type { EnvironmentView } from "api-server-api";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DisclosureChevron } from "@/components/ui/disclosure";
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
import {
  useDeleteEnvironment,
  useSetEnvironmentAwake,
} from "../api/mutations.js";
import {
  environmentStateLabel,
  KEPT,
  KEPT_AWAKE,
  keptAwake,
} from "../lib/environment-list.js";

const ADDRESSES_INSET = 16;

/**
 * UNIT_BOUNDARY_DESCRIPTION: One Environment as a row of the Artifacts list,
 * shaped like an artifact's: the sharing icon that opens its Share dialog,
 * its name, whether it runs, when it is deleted or that it is kept, whether it is kept awake, its agent, and one link per
 * address that opens a new tab. A single address stays on the row. Several
 * addresses sit on a line under the row, each with its name, so the links
 * never crowd out the name; the line is open until someone folds it with the
 * row's chevron. The menu sets its expiry, keeps it awake or lets it sleep
 * again, and deletes it. The icon says whether anyone beyond the owner and
 * the agent's editors may open it; an Environment is never public.
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
  const setAwake = useSetEnvironmentAwake();
  const awake = keptAwake(environment);
  const running = environment.state === "running";
  const links = environment.endpoints.filter((e) => e.url !== null);
  const several = links.length > 1;
  const [addressesOpen, setAddressesOpen] = useState(true);
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
      className="group w-full text-left text-sm text-muted-foreground"
      data-testid="environment-row"
      data-environment={environment.name}
    >
      <div
        className="flex h-8 items-center gap-1.5 pr-3 transition-colors hover:bg-muted"
        style={{ paddingLeft: treeIndent(depth) }}
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
              label={KEPT}
              content={KEPT}
              className="shrink-0 gap-1 whitespace-nowrap text-xs text-muted-foreground"
            >
              <Calendar size={12} />
              kept
            </HintTooltip>
          )}
          {awake && (
            <HintTooltip
              label={KEPT_AWAKE}
              content={KEPT_AWAKE}
              className="shrink-0 gap-1 whitespace-nowrap text-xs text-muted-foreground"
            >
              <Awake size={12} />
              awake
            </HintTooltip>
          )}
        </div>
        {showAgent && <AgentByline agentId={environment.owningAgentId} />}
        {!several &&
          links.map((endpoint) => (
            <AddressLink
              key={endpoint.name}
              environment={environment}
              endpoint={endpoint}
              named={false}
            />
          ))}
        {several && (
          <Tooltip content={addressesOpen ? "Hide addresses" : "Show addresses"}>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0"
              aria-expanded={addressesOpen}
              aria-label={`${addressesOpen ? "Hide" : "Show"} the addresses of ${environment.name}`}
              data-testid="environment-addresses-toggle"
              onClick={() => setAddressesOpen((open) => !open)}
            >
              <DisclosureChevron open={addressesOpen} />
            </Button>
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
            <DropdownMenuItem onSelect={() => onShare(environment)}>
              <UserMultiple size={14} />
              Share
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onSetExpiry(environment)}>
              <Calendar size={14} />
              Set expiration
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={setAwake.isPending}
              onSelect={() =>
                setAwake.mutate({ id: environment.id, awake: !awake })
              }
            >
              {awake ? <Asleep size={14} /> : <Awake size={14} />}
              {awake ? "Let it sleep when idle" : "Keep awake"}
            </DropdownMenuItem>
            <DropdownMenuItem
              tone="danger"
              onSelect={() => void handleDelete()}
            >
              <TrashCan size={14} />
              Delete Environment
            </DropdownMenuItem>
          </RowActionsMenu>
        </div>
      </div>
      {several && addressesOpen && (
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pr-3 pb-1.5"
          style={{ paddingLeft: treeIndent(depth) + ADDRESSES_INSET }}
          data-testid="environment-addresses"
        >
          {links.map((endpoint) => (
            <AddressLink
              key={endpoint.name}
              environment={environment}
              endpoint={endpoint}
              named
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AddressLink({
  environment,
  endpoint,
  named,
}: {
  environment: EnvironmentView;
  endpoint: EnvironmentView["endpoints"][number];
  named: boolean;
}) {
  return (
    <Tooltip content={endpoint.url}>
      <a
        href={endpoint.url!}
        target="_blank"
        rel="noreferrer"
        aria-label={`Open ${endpoint.name} of ${environment.name}`}
        data-testid="environment-link"
        className="flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:bg-background hover:text-accent"
      >
        {named && <span>{endpoint.name}</span>}
        <Launch size={12} aria-hidden className="shrink-0" />
      </a>
    </Tooltip>
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
