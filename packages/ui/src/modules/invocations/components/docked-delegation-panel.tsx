import { Bot, Close, Locked } from "@carbon/icons-react";
import type { DelegationNode } from "api-server-api";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { ChatMessage } from "../../sessions/components/chat-message.js";
import { TurnTelemetry } from "../../telemetry/components/turn-telemetry.js";
import {
  useDelegationTranscript,
  useDelegationTree,
  useInvocationTurns,
} from "../api/queries.js";
import { delegationState, firstLine } from "../lib/delegation-state.js";
import { framesToMessages } from "../lib/frames-to-messages.js";
import { DelegationStatePill } from "./delegation-state-pill.js";

interface Props {
  driverAgentId: string;
  id: string;
}

const noop = () => {};

export function DockedDelegationPanel({ driverAgentId, id }: Props) {
  const close = useStore((s) => s.setOpenDelegation);
  const agents = useAgentsList();
  const ids = useMemo(() => [id], [id]);
  const {
    data: tree,
    isPending: treePending,
    isError: treeUnread,
  } = useDelegationTree(driverAgentId, ids);
  const node = tree?.nodes[0];
  const driverName =
    agents.find((a) => a.id === driverAgentId)?.name ?? driverAgentId;
  const agentState = agents.find((a) => a.id === id)?.state;

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
          {node ? firstLine(node.prompt) : id}
        </span>
        {node && (
          <DelegationStatePill state={delegationState(node, agentState)} />
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          onClick={() => close(null)}
        >
          <Close size={16} />
        </Button>
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
          <Spinner size={16} />
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
    node.status === "running",
  );
  const turn = telemetry?.available ? telemetry.turns[node.id] : undefined;
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

  return (
    <>
      <div className="flex max-h-[60%] shrink-0 flex-col gap-1 overflow-y-auto border-b border-border/60 px-4 py-2 text-xs text-muted-foreground">
        <span>temporary agent of {driverName}</span>
        {turn && (
          <TurnTelemetry
            agentId={driverAgentId}
            invocationId={node.id}
            turn={turn}
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
            <Spinner size={16} />
          </div>
        ) : transcript.isError ? (
          <Notice text="This conversation is no longer kept." />
        ) : (
          <>
            {transcript.data.truncated && (
              <Notice text="The start of this conversation was not kept." />
            )}
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
          </>
        )}
      </div>
      {finished && (
        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
          <Locked size={14} aria-hidden />
          Read-only. The agent was released when it reported.
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
