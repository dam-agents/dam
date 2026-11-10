import { Cube, TrashCan } from "@carbon/icons-react";
import type { EnvironmentView, KeptSubAgent } from "api-server-api";
import { type CSSProperties, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { TREE_GUIDE, treeGuideX, treeIndent } from "@/components/ui/tree-guide";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { ArtifactDeletionChip } from "../../artifacts/components/artifact-badges.js";
import { EnvironmentExpiryDialog } from "../../environments/components/environment-expiry-dialog.js";
import { EnvironmentRow } from "../../environments/components/environment-row.js";
import { EnvironmentShareDialog } from "../../environments/components/environment-share-dialog.js";
import { useDeleteKeptSubAgent } from "../api/mutations.js";
import { keptStateLabel } from "../lib/kept-state.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sub-agents kept under this agent, below its
 * Environments in the Artifacts list: a group that folds like a folder, with
 * a tree of every kept sub-agent at any depth, each under the kept sub-agent
 * that spawned it, and under each its own Environments. A row says what the
 * sub-agent does and until when it is kept, and its menu deletes it with
 * everything under it. A kept sub-agent counts against its owner's limits
 * while it exists, so it is listed where it is easy to see and remove. The
 * list passes only the ones it shows, so the group is absent when there are
 * none.
 */
export function KeptSubAgentsGroup({
  subAgents,
  environments,
  collapsed,
  onToggle,
}: {
  subAgents: readonly KeptSubAgent[];
  environments: readonly EnvironmentView[];
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [shareId, setShareId] = useState<string | null>(null);
  const [expiryId, setExpiryId] = useState<string | null>(null);
  const shareTarget = environments.find((e) => e.id === shareId);
  const expiryTarget = environments.find((e) => e.id === expiryId);
  const count = subAgents.length;
  const branch: Branch = {
    childrenOf: (id) => subAgents.filter((s) => s.parentId === id),
    environmentsOf: (id) => environments.filter((e) => e.owningAgentId === id),
    onShare: (e) => setShareId(e.id),
    onSetExpiry: (e) => setExpiryId(e.id),
  };
  return (
    <div data-testid="artifacts-kept-sub-agents">
      <div className="group flex h-8 items-center transition-colors hover:bg-muted">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-3 text-left text-sm text-foreground"
        >
          <Cube size={16} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">Kept sub-agents</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {count} sub-agent{count === 1 ? "" : "s"}
          </span>
        </button>
      </div>
      {!collapsed && (
        <KeptLevel
          subAgents={branch.childrenOf(null)}
          environments={[]}
          depth={1}
          branch={branch}
        />
      )}
      {shareTarget && (
        <EnvironmentShareDialog
          environment={shareTarget}
          onClose={() => setShareId(null)}
        />
      )}
      {expiryTarget && (
        <EnvironmentExpiryDialog
          environment={expiryTarget}
          onClose={() => setExpiryId(null)}
        />
      )}
    </div>
  );
}

interface Branch {
  childrenOf: (parentId: string | null) => KeptSubAgent[];
  environmentsOf: (agentId: string) => EnvironmentView[];
  onShare: (environment: EnvironmentView) => void;
  onSetExpiry: (environment: EnvironmentView) => void;
}

// UNIT_BOUNDARY_DESCRIPTION: one level of the tree: the Environments of the sub-agent above it, then its kept sub-agents, each followed by its own level, with the guide line of the level above.
function KeptLevel({
  subAgents,
  environments,
  depth,
  branch,
}: {
  subAgents: readonly KeptSubAgent[];
  environments: readonly EnvironmentView[];
  depth: number;
  branch: Branch;
}) {
  if (subAgents.length === 0 && environments.length === 0) return null;
  return (
    <div style={{ "--tree-guide-x": treeGuideX(depth - 1) } as CSSProperties}>
      {environments.map((environment) => (
        <div key={environment.id} className={TREE_GUIDE}>
          <EnvironmentRow
            environment={environment}
            depth={depth}
            showAgent={false}
            onShare={branch.onShare}
            onSetExpiry={branch.onSetExpiry}
          />
        </div>
      ))}
      {subAgents.map((subAgent) => (
        <div key={subAgent.id} className={TREE_GUIDE}>
          <KeptSubAgentRow subAgent={subAgent} depth={depth} />
          <KeptLevel
            subAgents={branch.childrenOf(subAgent.id)}
            environments={branch.environmentsOf(subAgent.id)}
            depth={depth + 1}
            branch={branch}
          />
        </div>
      ))}
    </div>
  );
}

function KeptSubAgentRow({
  subAgent,
  depth,
}: {
  subAgent: KeptSubAgent;
  depth: number;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const remove = useDeleteKeptSubAgent();
  const agent = useAgentsList().find((a) => a.id === subAgent.id);
  const name = subAgent.label ?? subAgent.id;
  const state = keptStateLabel(subAgent, agent?.state);

  const handleDelete = async () => {
    if (
      await showConfirm(
        "Its files, its own Environments and its sub-agents are deleted with it.",
        `Delete sub-agent “${name}”?`,
        { kind: "destructive", confirmLabel: "Delete sub-agent" },
      )
    )
      remove.mutate({ id: subAgent.id });
  };

  return (
    <div
      title={`${name}, kept until ${new Date(subAgent.keepUntil).toLocaleString()}`}
      className="group flex h-8 w-full items-center gap-1.5 pr-3 text-left text-sm text-muted-foreground transition-colors hover:bg-muted"
      style={{ paddingLeft: treeIndent(depth) }}
      data-testid="kept-sub-agent-row"
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <span className="min-w-12 shrink-[100000] truncate">{name}</span>
        <Badge
          size="sm"
          variant={state === "running" ? "success" : "muted"}
          className="h-4 shrink-0 py-0 leading-none"
        >
          {state}
        </Badge>
        <ArtifactDeletionChip
          expiresAt={subAgent.keepUntil}
          className="text-xs text-muted-foreground"
        />
      </div>
      <div className="shrink-0">
        <RowActionsMenu
          label={`Actions for ${name}`}
          testId="kept-sub-agent-actions"
          dense
          className={HOVER_ACTION}
          disabled={remove.isPending}
        >
          <DropdownMenuItem tone="danger" onSelect={() => void handleDelete()}>
            <TrashCan size={14} />
            Delete sub-agent
          </DropdownMenuItem>
        </RowActionsMenu>
      </div>
    </div>
  );
}
