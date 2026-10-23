import type { BindPickerCopy } from "../../agents/components/bind/agent-bind-picker.js";
import {
  readCallbackErrorFromSearch,
  readFlowIdFromSearch,
} from "../../agents/components/bind/bind-flow.js";
import { ChannelBindView } from "../../agents/components/bind/channel-bind-view.js";
import { useBindTelegramChat } from "../api/mutations.js";
import { useTelegramBindFlow } from "../api/queries.js";
import { bindErrorCopy, callbackErrorCopy } from "../lib/bind-flow.js";
import { TelegramBindSuccess } from "./telegram-bind-success.js";

const flowId = readFlowIdFromSearch(window.location.search);
const callbackError = readCallbackErrorFromSearch(window.location.search);

export function TelegramBindView() {
  const bind = useBindTelegramChat();
  const flow = useTelegramBindFlow(flowId);
  return (
    <ChannelBindView
      messenger="telegram"
      flowId={flowId}
      callbackError={callbackError}
      missingFlow={{
        title: "This page is opened from Telegram",
        hint: "Send `/bind` in the chat to get a fresh link.",
        terminal: true,
      }}
      flow={flow}
      bind={bind}
      bound={(agent, result, flow) => ({
        agentName: agent.name,
        chatTitle: flow?.chatTitle ?? result.chatTitle,
      })}
      success={(bound) => (
        <TelegramBindSuccess
          agentName={bound.agentName}
          chatTitle={bound.chatTitle}
        />
      )}
      pickerCopy={pickerCopy}
      callbackCopy={callbackErrorCopy}
      errorCopy={bindErrorCopy}
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
