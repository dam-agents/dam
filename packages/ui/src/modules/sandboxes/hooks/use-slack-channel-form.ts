import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { AgentView } from "../../../types.js";
import { useConnectSlack } from "../../agents/api/mutations.js";
import { planSlackChannelSave } from "../lib/slack-channel-save.js";

export type SlackChannel = Extract<
  AgentView["channels"][number],
  { type: "slack" }
>;

export const slackChannelFormSchema = z.object({
  channelId: z.string().trim().min(1, "Enter the Slack channel ID."),
  ambient: z.boolean(),
});

export type SlackChannelFormValues = z.infer<typeof slackChannelFormSchema>;

export function findSlackChannels(
  agent: AgentView | undefined,
): SlackChannel[] {
  return (
    agent?.channels.filter((c): c is SlackChannel => c.type === "slack") ?? []
  );
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
