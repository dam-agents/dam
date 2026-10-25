import { ChannelType, type StarterKitView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { SlackChannelPicker } from "../../slack/components/slack-channel-picker.js";
import { useTelegramBot } from "../../telegram/api/queries.js";

const MESSENGERS = [
  {
    type: "slack",
    channelType: ChannelType.Slack,
    title: "Slack",
    blurb:
      "Your team can interact with the agent in a Slack channel or their DMs.",
  },
  {
    type: "telegram",
    channelType: ChannelType.Telegram,
    title: "Telegram",
    blurb: "Your team can interact with the agent in a Telegram group or DM.",
  },
] as const;

interface Props {
  kit: StarterKitView;
  available: Partial<Record<ChannelType, boolean>>;
  slackChannelIds: readonly string[];
  onSlackChannelIdsChange: (ids: string[]) => void;
}

export function KitChannelsSection({
  kit,
  available,
  slackChannelIds,
  onSlackChannelIdsChange,
}: Props) {
  const offered = MESSENGERS.filter((m) => available[m.channelType]);
  if (offered.length === 0) return null;
  return (
    <section className="mb-8">
      <SectionLabel spaced>
        Channels <span className="font-normal">(optional)</span>
      </SectionLabel>
      <ul className="flex flex-col gap-2">
        {offered.map((messenger) => {
          const fromKit = kit.channels.find((c) => c.type === messenger.type);
          return (
            <li
              key={messenger.type}
              className={cn(
                "rounded-lg border px-4 py-3",
                fromKit ? "border-kit-line bg-kit-surface" : "border-border",
              )}
            >
              <div className="flex items-start gap-3">
                <ConnectionIcon
                  iconSlug={messenger.type}
                  alt=""
                  size={16}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {messenger.title}
                    </span>
                    {fromKit && (
                      <Badge variant="kit" size="sm">
                        Starter kit
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {fromKit?.note ?? messenger.blurb}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-3 pl-7">
                {messenger.type === "slack" ? (
                  <SlackSetup
                    directOnly={fromKit?.conversation === "direct"}
                    slackChannelIds={slackChannelIds}
                    onSlackChannelIdsChange={onSlackChannelIdsChange}
                  />
                ) : (
                  <TelegramSetup />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function SlackSetup({
  directOnly,
  slackChannelIds,
  onSlackChannelIdsChange,
}: {
  directOnly: boolean;
  slackChannelIds: readonly string[];
  onSlackChannelIdsChange: (ids: string[]) => void;
}) {
  const { name, short } = getBrand();
  if (directOnly)
    return (
      <p className="text-sm text-muted-foreground">
        Once the agent is created, open a DM with @{name} in Slack and run{" "}
        <code>/{short} bind</code>, then pick this agent on the page Slack
        opens.
      </p>
    );
  return (
    <>
      <SlackChannelPicker
        value={slackChannelIds}
        onChange={onSlackChannelIdsChange}
      />
      <p className="text-sm text-muted-foreground">
        To talk to the agent in a direct message too: once it is created, open a
        DM with @{name} and run <code>/{short} bind</code>.
      </p>
    </>
  );
}

function TelegramSetup() {
  const handle = useTelegramBot().data?.username;
  return (
    <p className="text-sm text-muted-foreground">
      Once the agent is created: add{" "}
      {handle ? (
        <a
          href={`https://t.me/${handle}`}
          target="_blank"
          rel="noreferrer"
          className="text-accent underline-offset-2 hover:underline"
        >
          @{handle}
        </a>
      ) : (
        "the Telegram bot"
      )}{" "}
      to the chat, send <code>/bind</code> there, and pick this agent on the
      page it opens.
    </p>
  );
}
