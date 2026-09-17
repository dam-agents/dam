import { useState } from "react";

import type { AgentView } from "../../../types.js";
import {
  AgentBindPicker,
  type BindPickerCopy,
} from "../../agents/components/bind/agent-bind-picker.js";
import { BindTerminalPage } from "../../agents/components/bind/bind-terminal-page.js";
import { useBindTelegramChat } from "../api/mutations.js";
import { useTelegramBindFlow, useTelegramBot } from "../api/queries.js";
import {
  type BindErrorCopy,
  bindErrorCopy,
  callbackErrorCopy,
  readCallbackErrorFromSearch,
  readFlowIdFromSearch,
} from "../lib/bind-flow.js";

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
          hint: "Send `/bind` in your chat to get a fresh link.",
          terminal: true,
        }}
      />
    );
  }
  if (bound) {
    return (
      <BindSuccess agentName={bound.agentName} chatTitle={bound.chatTitle} />
    );
  }
  if (error?.terminal) {
    return <TerminalError copy={error} />;
  }

  const pick = (agent: AgentView) => {
    setError(null);
    bind.mutate(
      { agentId: agent.id, flowId },
      {
        onSuccess: (res) =>
          setBound({ agentName: agent.name, chatTitle: res.chatTitle }),
        onError: (e) => {
          const code = (e as { data?: { code?: string } }).data?.code;
          setError(bindErrorCopy(code));
        },
      },
    );
  };

  return (
    <AgentBindPicker
      copy={pickerCopy(flow.data?.chatTitle ?? null)}
      error={error}
      pending={bind.isPending}
      onPick={pick}
      onAgentCreated={() => setError(null)}
    />
  );
}

function pickerCopy(chatTitle: string | null): BindPickerCopy {
  return {
    messenger: "telegram",
    title: chatTitle ? `Pick an agent for ${chatTitle}` : "Pick an agent",
    subtitle:
      "Choose which agent to add to this chat. A chat talks to one agent — send /unbind there to swap it for another.",
    emptySubtitle:
      "You don't own any agents yet. Create one to add it to this chat.",
    consent:
      "Everyone in the chat will be able to use the agent. Turns run under the agent's own connected accounts and API tokens, and your acceptance of the Terms of Use covers every turn.",
    action: "Add to chat",
  };
}

function BindSuccess({
  agentName,
  chatTitle,
}: {
  agentName: string;
  chatTitle: string | null;
}) {
  const bot = useTelegramBot();
  return (
    <BindTerminalPage
      messenger="telegram"
      title={chatTitle ? `“${chatTitle}” is connected` : "Chat connected"}
    >
      <p>
        The chat is now connected to <strong>{agentName}</strong>. Return to
        Telegram — the bot has posted a confirmation in your chat. Send{" "}
        <code>/unbind</code> there to disconnect.
      </p>
      {bot.data?.username && (
        <a
          className="underline text-foreground"
          href={`https://t.me/${bot.data.username}`}
        >
          Open @{bot.data.username} in Telegram
        </a>
      )}
    </BindTerminalPage>
  );
}

function TerminalError({ copy }: { copy: BindErrorCopy }) {
  return (
    <BindTerminalPage messenger="telegram" title={copy.title}>
      <p>{copy.hint}</p>
    </BindTerminalPage>
  );
}
