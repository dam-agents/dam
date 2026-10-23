import type { ReactNode } from "react";
import { useState } from "react";

import type { AgentView } from "../../../../types.js";
import { AgentBindPicker, type BindPickerCopy } from "./agent-bind-picker.js";
import type { BindErrorCopy } from "./bind-flow.js";
import type { BindMessenger } from "./bind-page.js";
import { BindTerminalPage } from "./bind-terminal-page.js";
import { withCommandChips } from "./command-chip.js";

interface BindMutation<TResult> {
  mutate: (
    input: { agentId: string; flowId: string },
    options: {
      onSuccess: (result: TResult) => void;
      onError: (error: unknown) => void;
    },
  ) => void;
  isPending: boolean;
}

interface Props<TFlow, TResult, TBound> {
  messenger: BindMessenger;
  flowId: string | null;
  callbackError: string | null;
  missingFlow: BindErrorCopy;
  flow: { data: TFlow | null | undefined; isSuccess: boolean };
  bind: BindMutation<TResult>;
  bound: (
    agent: AgentView,
    result: TResult,
    flow: TFlow | null | undefined,
  ) => TBound;
  success: (bound: TBound) => ReactNode;
  pickerCopy: (flow: TFlow | null | undefined) => BindPickerCopy;
  callbackCopy: (code: string) => BindErrorCopy;
  errorCopy: (code: string | undefined) => BindErrorCopy;
}

// UNIT_BOUNDARY_DESCRIPTION: the one state machine a chat-messenger bind page runs: a callback error, a page opened without a flow id, a completed bind, a terminal failure, a flow the server no longer knows, and the agent picker. The messenger supplies its own flow query, its bind mutation, its copy, and how a finished bind reads back.
export function ChannelBindView<TFlow, TResult, TBound>({
  messenger,
  flowId,
  callbackError,
  missingFlow,
  flow,
  bind,
  bound,
  success,
  pickerCopy,
  callbackCopy,
  errorCopy,
}: Props<TFlow, TResult, TBound>) {
  const [error, setError] = useState<BindErrorCopy | null>(null);
  const [boundState, setBound] = useState<TBound | null>(null);

  if (callbackError) {
    return (
      <BindTerminalError
        messenger={messenger}
        copy={callbackCopy(callbackError)}
      />
    );
  }
  if (!flowId) {
    return <BindTerminalError messenger={messenger} copy={missingFlow} />;
  }
  if (boundState) return <>{success(boundState)}</>;
  if (error?.terminal) {
    return <BindTerminalError messenger={messenger} copy={error} />;
  }
  if (flow.isSuccess && !flow.data) {
    return (
      <BindTerminalError
        messenger={messenger}
        copy={errorCopy("BAD_REQUEST")}
      />
    );
  }

  const pick = (agent: AgentView) => {
    setError(null);
    bind.mutate(
      { agentId: agent.id, flowId },
      {
        onSuccess: (result) => setBound(bound(agent, result, flow.data)),
        onError: (failure) => {
          const code = (failure as { data?: { code?: string } }).data?.code;
          setError(errorCopy(code));
        },
      },
    );
  };

  return (
    <AgentBindPicker
      copy={pickerCopy(flow.data)}
      error={error}
      pending={bind.isPending}
      onPick={pick}
      onAgentCreated={() => setError(null)}
    />
  );
}

export function BindTerminalError({
  messenger,
  copy,
}: {
  messenger: BindMessenger;
  copy: BindErrorCopy;
}) {
  return (
    <BindTerminalPage messenger={messenger} title={copy.title}>
      <p>{withCommandChips(copy.hint)}</p>
    </BindTerminalPage>
  );
}
