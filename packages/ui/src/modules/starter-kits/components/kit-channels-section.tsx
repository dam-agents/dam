import type { StarterKitView } from "api-server-api";

import { FormField } from "@/components/form-field";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { FIELD_INSET } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";

const CHANNELS = [
  {
    type: "slack" as const,
    title: "Slack Channel",
    blurb:
      "Your team can interact with the agent in a Slack channel or their DMs.",
  },
  {
    type: "telegram" as const,
    title: "Telegram Chat",
    blurb: "Your team can interact with the agent in a Telegram group or DM.",
  },
];

interface Props {
  kit: StarterKitView;
  slackChannelId: string;
  onSlackChannelIdChange: (value: string) => void;
}

export function KitChannelsSection({
  kit,
  slackChannelId,
  onSlackChannelIdChange,
}: Props) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>
        Channels <span className="font-normal">(optional)</span>
      </SectionLabel>

      <ul className={cn(FIELD_INSET, "flex flex-col gap-2")}>
        {CHANNELS.map((channel) => {
          const fromKit = kit.channels.find((c) => c.type === channel.type);
          return (
            <li
              key={channel.type}
              className={cn(
                "rounded-lg border px-4 py-3",
                fromKit ? "border-kit-line bg-kit-surface" : "border-border",
              )}
            >
              <div className="flex items-start gap-3">
                <ConnectionIcon
                  iconSlug={channel.type}
                  alt=""
                  size={16}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-foreground">
                      {channel.title}
                    </span>
                    {fromKit && (
                      <Badge variant="kit" size="sm">
                        Starter Kit
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {fromKit?.note ?? channel.blurb}
                  </p>
                </div>
                {channel.type === "slack" ? (
                  <Checkbox
                    checked={slackChannelId.trim().length > 0}
                    disabled
                    aria-label="Slack is bound by giving a channel ID below"
                    className="mt-0.5 shrink-0"
                  />
                ) : (
                  <Checkbox
                    checked={false}
                    disabled
                    aria-label="Telegram is bound in chat after the agent starts"
                    className="mt-0.5 shrink-0"
                  />
                )}
              </div>

              {channel.type === "slack" && (
                <div className="mt-3 pl-7">
                  <FormField
                    label="Slack channel ID"
                    disableInset
                    hint="From the channel's details in Slack — starts with C. The bot must be a member of the channel."
                  >
                    <Input
                      className="h-10"
                      value={slackChannelId}
                      onChange={(e) => onSlackChannelIdChange(e.target.value)}
                      placeholder="C0…"
                      data-testid="starter-kit-slack-channel-id"
                    />
                  </FormField>
                </div>
              )}

              {channel.type === "telegram" && (
                <p className="mt-2 pl-7 text-xs text-muted-foreground">
                  Bound in chat with /platform bind once the agent is running —
                  no form can do it.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
