import { AddComment, Bot, Locked } from "@carbon/icons-react";
import { type DelegationNode, delegationTitle } from "api-server-api";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import { framesToMessages } from "../../acp/frames-to-messages.js";
import { findAgent, useAgents } from "../../agents/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { AgentChangeCards } from "../../sessions/components/agent-change-card.js";
import { ChatMessage } from "../../sessions/components/chat-message.js";
import { SidePanelCloseButton } from "../../sessions/components/side-panel-close-button.js";
import { useTurnSpend } from "../../spend/api/queries.js";
import { TurnTelemetry } from "../../telemetry/components/turn-telemetry.js";
import {
  useDelegationTranscript,
  useDelegationTree,
  useInvocationTurns,
} from "../api/queries.js";
import { useContinueInNewChat } from "../hooks/use-continue-in-new-chat.js";
import { delegationState } from "../lib/delegation-state.js";
import {
  DelegationOwnersProvider,
  useDelegationOwners,
} from "./delegation-owners.js";
import { DelegationStatePill } from "./delegation-state-pill.js";

interface Props {
  driverAgentId: string;
  id: string;
}

const noop = () => {};

export function DockedDelegationPanel({ driverAgentId, id }: Props) {
  const setDock = useStore((s) => s.setDock);
  const { data: agentsData } = useAgents();
  const ids = useMemo(() => [id], [id]);
  const {
    data: tree,
    isPending: treePending,
    isError: treeUnread,
  } = useDelegationTree(driverAgentId, ids);
  const node = tree?.nodes[0];
  const driverName =
    findAgent(agentsData, driverAgentId)?.name ?? driverAgentId;
  const agentState = findAgent(agentsData, id)?.state;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <span
          aria-hidden
          className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-accent-light text-accent"
        >
          <Bot size={13} />
        </span>
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
          title={node?.prompt}
        >
          {node ? delegationTitle(node) : id}
        </span>
        {node && (
          <DelegationStatePill state={delegationState(node, agentState)} />
        )}
        <SidePanelCloseButton corner="-mr-4" onClose={() => setDock(null)} />
      </div>
      {node ? (
        <PanelBody
          node={node}
          driverAgentId={driverAgentId}
          driverName={driverName}
        />
      ) : treeUnread ? (
        <Notice text="This delegation could not be read." />
      ) : !treePending ? (
        <Notice text="This delegation is no longer recorded." />
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size={18} />
        </div>
      )}
    </div>
  );
}

function PanelBody({
  node,
  driverAgentId,
  driverName,
}: {
  node: DelegationNode;
  driverAgentId: string;
  driverName: string;
}) {
  const telemetryEnabled = useFeatures().data?.["agent-telemetry"] ?? false;
  const ids = useMemo(() => [node.id], [node.id]);
  const { data: telemetry } = useInvocationTurns(
    driverAgentId,
    ids,
    telemetryEnabled,
    [node],
  );
  const turn = telemetry?.available ? telemetry.turns[node.id] : undefined;
  const spendTurns = useMemo(() => (turn ? [turn] : []), [turn]);
  const { data: turnSpend } = useTurnSpend(node.id, null, spendTurns);
  const finished = node.status !== "running";
  const transcript = useDelegationTranscript(
    driverAgentId,
    node.id,
    finished && node.transcriptAvailable,
  );
  const messages = useMemo(
    () => (transcript.data ? framesToMessages(transcript.data.frames) : []),
    [transcript.data],
  );
  const owners = useDelegationOwners(messages);
  const continueInNewChat = useContinueInNewChat(driverAgentId, node.id);

  return (
    <>
      <div className="flex max-h-[60%] shrink-0 flex-col gap-1 overflow-y-auto border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
        <span>temporary agent of {driverName}</span>
        {turn && (
          <TurnTelemetry
            agentId={driverAgentId}
            invocationId={node.id}
            turn={turn}
            spend={turnSpend?.get(turn.turnId)}
            className="w-full"
          />
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {!finished ? (
          <Notice text="This agent is still working. Its conversation opens here once it reports." />
        ) : !node.transcriptAvailable ? (
          <Notice text="This conversation was not captured." />
        ) : transcript.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner size={18} />
          </div>
        ) : transcript.isError ? (
          <Notice text="This conversation is no longer kept." />
        ) : (
          <DelegationOwnersProvider value={owners}>
            {transcript.data.truncated && (
              <Notice text="The start of this conversation was not kept." />
            )}
            {/* UNIT_BOUNDARY_DESCRIPTION: a change in a sub-agent's transcript belongs to that agent, and no tab of the driver's panel holds it, so the transcript shows no card for it. */}
            <AgentChangeCards.Provider value={false}>
              {messages.map((message, i) => (
                <ChatMessage
                  key={message.id}
                  message={message}
                  userLabel={driverName}
                  readOnly
                  isLast={i === messages.length - 1}
                  hasPendingPermission={false}
                  onRetry={noop}
                  onFileClick={noop}
                  onDelete={noop}
                />
              ))}
            </AgentChangeCards.Provider>
          </DelegationOwnersProvider>
        )}
      </div>
      {finished && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <Locked size={14} aria-hidden />
          <span className="min-w-0 flex-1">
            Read-only. The agent was released when it reported.
          </span>
          <Button variant="outline" size="xs" onClick={continueInNewChat}>
            <AddComment size={14} />
            Continue in new chat
          </Button>
        </div>
      )}
    </>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <p className="py-2 text-center text-xs italic text-muted-foreground">
      {text}
    </p>
  );
}
