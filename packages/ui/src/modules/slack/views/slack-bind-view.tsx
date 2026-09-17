import { useState } from "react";

import { getBrand } from "../../../brand.js";
import type { AgentView } from "../../../types.js";
import {
  AgentBindPicker,
  type BindPickerCopy,
} from "../../agents/components/bind/agent-bind-picker.js";
import { BindTerminalPage } from "../../agents/components/bind/bind-terminal-page.js";
import { useBindSlackChannel } from "../api/mutations.js";
import { useSlackBindFlow } from "../api/queries.js";
import {
  type BindErrorCopy,
  bindErrorCopy,
  callbackErrorCopy,
  readCallbackErrorFromSearch,
  readFlowIdFromSearch,
} from "../lib/bind-flow.js";

const flowId = readFlowIdFromSearch(window.location.search);
const callbackError = readCallbackErrorFromSearch(window.location.search);

export function SlackBindView() {
  const brandShort = getBrand().short;
  const bind = useBindSlackChannel();
  const flow = useSlackBindFlow(flowId);
  const [error, setError] = useState<BindErrorCopy | null>(null);
  const [bound, setBound] = useState<{
    agentName: string;
    channelTitle: string | null;
  } | null>(null);

  if (callbackError) {
    return (
      <TerminalError copy={callbackErrorCopy(callbackError, brandShort)} />
    );
  }
  if (!flowId) {
    return (
      <TerminalError
        copy={{
          title: "This page is opened from Slack",
          hint: `Run \`/${brandShort} bind\` in your channel to get a fresh link.`,
          terminal: true,
        }}
      />
    );
  }
  if (bound) {
    return (
      <BindSuccess
        agentName={bound.agentName}
        channelTitle={bound.channelTitle}
        brandShort={brandShort}
      />
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
          setBound({ agentName: agent.name, channelTitle: res.channelTitle }),
        onError: (e) => {
          const code = (e as { data?: { code?: string } }).data?.code;
          setError(bindErrorCopy(code, brandShort));
        },
      },
    );
  };

  return (
    <AgentBindPicker
      copy={pickerCopy(flow.data?.name)}
      error={error}
      pending={bind.isPending}
      onPick={pick}
      onAgentCreated={() => setError(null)}
    />
  );
}

function pickerCopy(channelName: string | undefined): BindPickerCopy {
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
  };
}

function BindSuccess({
  agentName,
  channelTitle,
  brandShort,
}: {
  agentName: string;
  channelTitle: string | null;
  brandShort: string;
}) {
  return (
    <BindTerminalPage
      messenger="slack"
      title={
        channelTitle ? `“${channelTitle}” is connected` : "Channel connected"
      }
    >
      <p>
        This channel is now connected to <strong>{agentName}</strong>. Return to
        Slack — the bot has posted a confirmation. A channel can hold several
        agents: start a mention with an agent's name to reach that one, or
        mention the bot with no name to reach the channel's default agent. Run{" "}
        <code>
          /{brandShort} unbind {agentName}
        </code>{" "}
        there to disconnect this one.
      </p>
    </BindTerminalPage>
  );
}

function TerminalError({ copy }: { copy: BindErrorCopy }) {
  return (
    <BindTerminalPage messenger="slack" title={copy.title}>
      <p>{copy.hint}</p>
    </BindTerminalPage>
  );
}
