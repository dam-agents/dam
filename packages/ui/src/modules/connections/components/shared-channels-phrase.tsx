import type { ReactNode } from "react";

import { BoldList, InlineList } from "../../../components/inline-list.js";
import {
  namesOf,
  type SharedChannel,
  sharedChannelsTitle,
} from "../../sandboxes/lib/shared-channels.js";

const NAMED_LIMIT = 3;

export function SharedChannelsPhrase({
  channels,
}: {
  channels: readonly SharedChannel[];
}) {
  const slackNames = namesOf(channels, "slack-channel");
  const telegramNames = namesOf(channels, "telegram-chat");
  const groupDms = channels.filter((c) => c.kind === "slack-group-dm").length;
  if (slackNames.length + telegramNames.length === 0 && groupDms <= 1)
    return <>{sharedChannelsTitle(channels)}</>;

  const groups: ReactNode[] = [];
  if (slackNames.length > 0)
    groups.push(
      <>
        the Slack {slackNames.length === 1 ? "channel" : "channels"}{" "}
        <BoldList items={slackNames} limit={NAMED_LIMIT} />
      </>,
    );
  if (groupDms > 0)
    groups.push(
      groupDms === 1 ? "a Slack group DM" : `${groupDms} Slack group DMs`,
    );
  if (telegramNames.length > 0)
    groups.push(
      <>
        the Telegram {telegramNames.length === 1 ? "chat" : "chats"}{" "}
        <BoldList items={telegramNames} limit={NAMED_LIMIT} />
      </>,
    );
  return <InlineList items={groups} />;
}
