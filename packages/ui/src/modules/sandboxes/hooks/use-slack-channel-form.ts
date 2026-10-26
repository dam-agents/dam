import { zodResolver } from "@hookform/resolvers/zod";
import { ChannelType, type SlackChannel } from "api-server-api";
import { useForm } from "react-hook-form";
import { match } from "ts-pattern";
import { z } from "zod";

import type { AgentView } from "../../../types.js";
import { useConnectSlack } from "../../agents/api/mutations.js";
import { planSlackChannelSave } from "../lib/slack-channel-save.js";

export type { SlackChannel };

const slackChannelFormSchema = z.object({
  channelId: z.string().trim().min(1, "Enter the Slack channel ID."),
  ambient: z.boolean(),
});

type SlackChannelFormValues = z.infer<typeof slackChannelFormSchema>;

export function findSlackChannels(
  agent: AgentView | undefined,
): SlackChannel[] {
  return agent?.channels.filter((c) => c.type === ChannelType.Slack) ?? [];
}

export function slackChannelLabel(channel: SlackChannel): string {
  if (!channel.label) return channel.slackChannelId;
  return match(channel.label)
    .with({ kind: "channel" }, (l) => `#${l.name}`)
    .with({ kind: "direct-message" }, (l) =>
      l.with ? `DM with ${l.with}` : "Direct message",
    )
    .with({ kind: "group-direct-message" }, (l) =>
      l.members.length > 0
        ? `Group DM with ${l.members.join(", ")}`
        : "Group DM",
    )
    .with({ kind: "gone" }, () => channel.slackChannelId)
    .exhaustive(() => channel.slackChannelId);
}

export function isSlackConversationGone(channel: SlackChannel): boolean {
  return channel.label?.kind === "gone";
}

export function useSlackChannelForm(
  agent: AgentView,
  channel: SlackChannel | undefined,
  onSaved: () => void,
) {
  const editing = !!channel;

  const connectSlack = useConnectSlack();

  const form = useForm<SlackChannelFormValues>({
    resolver: zodResolver(slackChannelFormSchema),
    defaultValues: {
      channelId: channel?.slackChannelId ?? "",
      ambient: channel?.ambient ?? false,
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const connect = planSlackChannelSave({
      agentId: agent.id,
      channel,
      values,
    });
    if (connect) await connectSlack.mutateAsync(connect);
    onSaved();
  });

  return { form, editing, onSubmit };
}
