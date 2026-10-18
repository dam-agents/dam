import { useState } from "react";

import type { AgentView } from "../../../types.js";
import {
  AgentBindPicker,
  type BindPickerCopy,
} from "../../agents/components/bind/agent-bind-picker.js";
import { BindTerminalPage } from "../../agents/components/bind/bind-terminal-page.js";
import { withCommandChips } from "../../agents/components/bind/command-chip.js";
import { useBindTelegramChat } from "../api/mutations.js";
import { useTelegramBindFlow } from "../api/queries.js";
import {
  type BindErrorCopy,
  bindErrorCopy,
  callbackErrorCopy,
  readCallbackErrorFromSearch,
  readFlowIdFromSearch,
} from "../lib/bind-flow.js";
import { TelegramBindSuccess } from "./telegram-bind-success.js";

const flowId = readFlowIdFromSearch(window.location.search);
const callbackError = readCallbackErrorFromSearch(window.location.search);

export function TelegramBindView() {
  const bind = useBindTelegramChat();
  const flow = useTelegramBindFlow(flowId);
  const [error, setError] = useState<BindErrorCopy | null>(null);
  const [bound, setBound] = useState<{
    agentName: string;
    chatTitle: string | null;
  } | null>(null);

  if (callbackError) {
    return <TerminalError copy={callbackErrorCopy(callbackError)} />;
  }
  if (!flowId) {
    return (
      <TerminalError
        copy={{
          title: "This page is opened from Telegram",
          hint: "Send `/bind` in the chat to get a fresh link.",
          terminal: true,
        }}
      />
    );
  }
  if (bound) {
    return (
      <TelegramBindSuccess
        agentName={bound.agentName}
        chatTitle={bound.chatTitle}
      />
    );
  }
  if (error?.terminal) {
    return <TerminalError copy={error} />;
  }
  if (flow.isSuccess && !flow.data) {
    return <TerminalError copy={bindErrorCopy("BAD_REQUEST")} />;
  }

  const pick = (agent: AgentView) => {
    setError(null);
    bind.mutate(
      { agentId: agent.id, flowId },
      {
        onSuccess: (res) =>
          setBound({
            agentName: agent.name,
            chatTitle: flow.data?.chatTitle ?? res.chatTitle,
          }),
        onError: (e) => {
          const code = (e as { data?: { code?: string } }).data?.code;
          setError(bindErrorCopy(code));
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

function pickerCopy(
  flow: { chatTitle: string | null; direct: boolean } | null | undefined,
): BindPickerCopy {
  const chatTitle = flow?.chatTitle ?? null;
  return {
    messenger: "telegram",
    title: chatTitle
      ? `Pick an agent for ${chatTitle}`
      : "Pick an agent for this chat",
    subtitle:
      "Choose which agent to add to this chat. A chat talks to one agent — send /unbind there to swap it for another.",
    emptySubtitle:
      "You don't own any agents yet. Create one to add it to this chat.",
    consent:
      "Everyone in the chat will be able to use the agent. Turns run under the agent's own connected accounts and API tokens, and your acceptance of the Terms of Use covers every turn.",
    action: "Add to chat",
    audience: !flow
      ? { kind: "unknown-conversation" }
      : flow.direct
        ? null
        : { kind: "telegram-chat", name: chatTitle },
  };
}

function TerminalError({ copy }: { copy: BindErrorCopy }) {
  return (
    <BindTerminalPage messenger="telegram" title={copy.title}>
      <p>{withCommandChips(copy.hint)}</p>
    </BindTerminalPage>
  );
}
