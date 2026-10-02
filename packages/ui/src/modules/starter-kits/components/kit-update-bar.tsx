import { Renew } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { ChatColumn } from "../../sessions/components/chat-column.js";
import { useSkipKitUpdate, useStartKitUpdate } from "../api/mutations.js";
import { useKitUpdate } from "../api/queries.js";
import { useKitName } from "../hooks/use-kit-name.js";
import { useKitUpdateSessionId } from "../hooks/use-kit-update-session.js";
import { KitUpdateChangesCard } from "./kit-update-changes-card.js";

export function KitUpdateBar({ agentId }: { agentId: string | null }) {
  const update = useKitUpdate(agentId);
  if (!agentId || !update) return null;
  if (update.state !== "available" && update.state !== "pending") return null;
  return <KitUpdateBarContent agentId={agentId} pending={update.pending} />;
}

function KitUpdateBarContent({
  agentId,
  pending,
}: {
  agentId: string;
  pending: NonNullable<ReturnType<typeof useKitUpdate>>["pending"];
}) {
  const agent = useAgentsList().find((a) => a.id === agentId);
  const kitName = useKitName(agent?.starterKit ?? null, true);
  const [cardOpen, setCardOpen] = useState(false);
  const [openWhenReady, setOpenWhenReady] = useState(false);
  const start = useStartKitUpdate();
  const skip = useSkipKitUpdate();
  const sessionId = useKitUpdateSessionId(agentId, pending);
  const openAgentSession = useStore((s) => s.openAgentSession);

  useEffect(() => {
    if (!openWhenReady || !sessionId) return;
    setOpenWhenReady(false);
    openAgentSession(agentId, sessionId);
  }, [openWhenReady, sessionId, agentId, openAgentSession]);

  const startUpdate = () =>
    start.mutate(agentId, { onSuccess: () => setOpenWhenReady(true) });

  return (
    <div className="px-4 md:px-8" data-testid="kit-update-bar">
      <ChatColumn>
        <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-kit-line bg-kit-surface px-4 py-2">
          <span className="min-w-0 truncate text-sm font-medium text-kit">
            {pending
              ? `${kitName} update in progress`
              : `${kitName} has a newer version`}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {!pending && (
              <Button
                variant="ghost"
                size="sm"
                disabled={skip.isPending || start.isPending}
                onClick={() => skip.mutate(agentId)}
              >
                Skip this version
              </Button>
            )}
            {pending && sessionId && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openAgentSession(agentId, sessionId)}
              >
                Continue update
              </Button>
            )}
            <HoverCard
              openDelay={150}
              closeDelay={300}
              open={cardOpen}
              onOpenChange={setCardOpen}
            >
              <HoverCardTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={start.isPending || skip.isPending}
                  className="font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
                  onClick={startUpdate}
                >
                  <Renew size={16} />
                  {start.isPending
                    ? "Starting…"
                    : pending
                      ? "Start again"
                      : "Update"}
                </Button>
              </HoverCardTrigger>
              <HoverCardContent
                side="top"
                align="end"
                className="w-[520px] max-w-[calc(100vw-2rem)] text-sm"
              >
                <KitUpdateChangesCard agentId={agentId} open={cardOpen} />
              </HoverCardContent>
            </HoverCard>
          </div>
        </div>
      </ChatColumn>
    </div>
  );
}
