import type { KitUpdatePending } from "api-server-api";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import { useStore } from "../../../store.js";
import { useKitUpdate, useKitUpdateChanges } from "../api/queries.js";
import { useKitUpdateSessionId } from "../hooks/use-kit-update-session.js";
import { kitUpdateBadge } from "../lib/kit-update-badge.js";
import { shortKitVersion } from "../lib/setup.js";
import {
  KitUpdatingBadgeFace,
  KitUpdatingPanel,
} from "./kit-updating-panel.js";

export function KitUpdateTag({
  agentId,
  onOpenAgent,
}: {
  agentId: string;
  onOpenAgent: () => void;
}) {
  const update = useKitUpdate(agentId);
  const badge = kitUpdateBadge(update);
  if (!update || !badge) return null;
  if (badge.kind === "running")
    return (
      <KitUpdatingTag
        agentId={agentId}
        pending={badge.pending}
        current={update.current}
        onOpenAgent={onOpenAgent}
      />
    );
  return (
    <Badge
      variant="kit"
      className="shrink-0 cursor-default"
      title="A newer version of this agent's starter kit is available. Open the agent to update it."
      data-testid="agent-kit-update-badge"
    >
      Kit update
    </Badge>
  );
}

function KitUpdatingTag({
  agentId,
  pending,
  current,
  onOpenAgent,
}: {
  agentId: string;
  pending: KitUpdatePending;
  current: string;
  onOpenAgent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: changes } = useKitUpdateChanges(
    agentId,
    pending.targetCommit,
    true,
  );
  const sessionId = useKitUpdateSessionId(agentId, pending);
  const openAgentSession = useStore((s) => s.openAgentSession);
  const version = changes?.versionTo ?? shortKitVersion(pending.targetCommit);
  const from = changes?.versionFrom ?? shortKitVersion(current);

  const continueUpdate = () => {
    setOpen(false);
    if (sessionId) openAgentSession(agentId, sessionId);
    else onOpenAgent();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <KitUpdatingBadgeFace
          version={version}
          onClick={(e) => e.stopPropagation()}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <KitUpdatingPanel
          from={from}
          to={version}
          startedAt={pending.startedAt}
          compareUrl={changes?.compareUrl ?? null}
          onContinue={continueUpdate}
        />
      </PopoverContent>
    </Popover>
  );
}
