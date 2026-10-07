import { ArrowRight } from "@carbon/icons-react";

import { ExplainerPopover } from "@/components/explainer-popover";

import { getBrand } from "../brand.js";
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
      label="How a Slack Channel differs from a Slack Account connection"
      footer={
        installRequestUrl && <SlackInstallRequest href={installRequestUrl} />
      }
    >
      <p>
        Lets people chat with this agent in a Slack DM or channel. Messages come
        from the {getBrand().name} bot, signed with the agent&apos;s name.
      </p>
      <p>
        Want the agent to use your Slack access to monitor or post on your
        behalf?{" "}
        <CrossLink
          label="Use a Slack connection"
          onFollow={onGoToConnections}
        />
      </p>
    </ExplainerPopover>
  );
}

export function SlackAccountExplainer({
  forAgent,
  onGoToChannels,
}: {
  forAgent: boolean;
  onGoToChannels?: () => void;
}) {
  const installRequestUrl = useSlackInstallRequestUrl();
  return (
    <ExplainerPopover
      side="bottom"
      label="How a Slack Account connection differs from a Slack Channel"
      footer={
        installRequestUrl && <SlackInstallRequest href={installRequestUrl} />
      }
    >
      <p>
        Lets {forAgent ? "this agent" : "an agent"} use your Slack account to
        search, read, and post anywhere you can. Its posts come from you, not
        the {getBrand().name} bot.
      </p>
      <p>
        Want people to chat with {forAgent ? "the agent" : "an agent"} in Slack?{" "}
        <CrossLink label="Add a Slack channel" onFollow={onGoToChannels} />
      </p>
    </ExplainerPopover>
  );
}
