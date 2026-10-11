import { ArrowRight } from "@carbon/icons-react";

import { ExplainerPopover } from "@/components/explainer-popover";

import { useSlackInstallRequestUrl } from "../modules/links/api/queries.js";
import { SlackInstallRequest } from "../modules/slack/components/slack-install-request.js";

function CrossLink({
  label,
  onFollow,
}: {
  label: string;
  onFollow?: () => void;
}) {
  if (!onFollow)
    return <span className="font-medium text-muted-foreground">{label}</span>;
  return (
    <button
      type="button"
      onClick={onFollow}
      className="inline-flex w-fit items-center gap-1 font-medium text-accent hover:underline"
    >
      {label} <ArrowRight size={14} />
    </button>
  );
}

export function SlackChannelExplainer({
  onGoToConnections,
}: {
  onGoToConnections?: () => void;
}) {
  const installRequestUrl = useSlackInstallRequestUrl();
  return (
    <ExplainerPopover
      label="How a Slack channel differs from a Slack account connection"
      footer={
        installRequestUrl && <SlackInstallRequest href={installRequestUrl} />
      }
    >
      <p>
        With Channels, you can DM or bind your agent to a team channel. The
        agent answers as itself always.
      </p>
      <p>
        If you want to give this agent access to your Slack account, that&apos;s
        a Connection.
      </p>
      <CrossLink label="Go to Connections" onFollow={onGoToConnections} />
    </ExplainerPopover>
  );
}

export function SlackAccountExplainer({
  onGoToChannels,
}: {
  onGoToChannels?: () => void;
}) {
  const installRequestUrl = useSlackInstallRequestUrl();
  return (
    <ExplainerPopover
      side="bottom"
      label="How a Slack account connection differs from a Slack channel"
      footer={
        installRequestUrl && <SlackInstallRequest href={installRequestUrl} />
      }
    >
      <p>
        With a Slack account connection, the agent works in your Slack as you.
        It can search, read and post anywhere your account can — including
        private channels and DMs.
      </p>
      <p>
        If you want to DM your agent or use it collaboratively with others in a
        team channel, add it to a channel instead.
      </p>
      <CrossLink label="Go to Channels" onFollow={onGoToChannels} />
    </ExplainerPopover>
  );
}
