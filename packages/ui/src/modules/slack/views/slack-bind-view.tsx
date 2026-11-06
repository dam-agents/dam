import { getBrand } from "../../../brand.js";
import type { BindPickerCopy } from "../../agents/components/bind/agent-bind-picker.js";
import {
  readCallbackErrorFromSearch,
  readFlowIdFromSearch,
} from "../../agents/components/bind/bind-flow.js";
import { ChannelBindView } from "../../agents/components/bind/channel-bind-view.js";
import { isSlackDirectMessageId } from "../../sandboxes/lib/shared-channels.js";
import { useFlowOpened } from "../../usage/lib/ui-telemetry.js";
import { useBindSlackChannel } from "../api/mutations.js";
import { useSlackBindFlow } from "../api/queries.js";
import { bindErrorCopy, callbackErrorCopy } from "../lib/bind-flow.js";
import { SlackBindSuccess } from "./slack-bind-success.js";

const flowId = readFlowIdFromSearch(window.location.search);
const callbackError = readCallbackErrorFromSearch(window.location.search);

export function SlackBindView() {
  const brandShort = getBrand().short;
  const bind = useBindSlackChannel();
  useFlowOpened("connect_slack");
  const flow = useSlackBindFlow(flowId);
  return (
    <ChannelBindView
      messenger="slack"
      flowId={flowId}
      callbackError={callbackError}
      missingFlow={{
        title: "This page is opened from Slack",
        hint: `Run \`/${brandShort} bind\` in the channel to get a fresh link.`,
        terminal: true,
      }}
      flow={flow}
      bind={bind}
      bound={(agent, result, flow) => ({
        agentId: agent.id,
        agentName: agent.name,
        slackChannelId: result.slackChannelId,
        channelTitle: flow?.name ?? result.channelTitle,
      })}
      success={(bound) => <SlackBindSuccess {...bound} />}
      pickerCopy={pickerCopy}
      callbackCopy={(code) => callbackErrorCopy(code, brandShort)}
      errorCopy={(code) => bindErrorCopy(code, brandShort)}
    />
  );
}

function pickerCopy(
  flow: { slackChannelId: string; name?: string } | null | undefined,
): BindPickerCopy {
  const channelName = flow?.name;
  return {
    messenger: "slack",
    title: channelName
      ? `Pick an agent for #${channelName}`
      : "Pick an agent for this channel",
    subtitle:
      "Choose which agent to add to this channel. You can add more agents to the same channel later.",
    emptySubtitle:
      "You don't own any agents yet. Create one to add it to this channel.",
    consent:
      "Everyone in the channel will be able to use the agent. Turns run under the agent's own connected accounts and API tokens, and your acceptance of the Terms of Use covers every turn.",
    action: "Add to channel",
    audience: !flow
      ? { kind: "unknown-conversation" }
      : isSlackDirectMessageId(flow.slackChannelId)
        ? null
        : {
            kind: "slack-channel",
            name: channelName ? `#${channelName}` : null,
          },
  };
}
