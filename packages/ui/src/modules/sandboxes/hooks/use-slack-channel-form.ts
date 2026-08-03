import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { AgentView } from "../../../types.js";
import {
  useConnectSlack,
  useDisconnectSlack,
} from "../../agents/api/mutations.js";

type SlackChannel = Extract<AgentView["channels"][number], { type: "slack" }>;

export const slackChannelFormSchema = z.object({
  channelId: z.string().trim().min(1, "Enter the Slack channel ID."),
  ambient: z.boolean(),
});

export type SlackChannelFormValues = z.infer<typeof slackChannelFormSchema>;

export function findSlackChannel(
  agent: AgentView | undefined,
): SlackChannel | undefined {
  return agent?.channels.find((c): c is SlackChannel => c.type === "slack");
}

export function useSlackChannelForm(agent: AgentView, onSaved: () => void) {
  const slackChannel = findSlackChannel(agent);
  const editing = !!slackChannel;

  const connectSlack = useConnectSlack();
  const disconnectSlack = useDisconnectSlack();

  const form = useForm<SlackChannelFormValues>({
    resolver: zodResolver(slackChannelFormSchema),
    defaultValues: {
      channelId: slackChannel?.slackChannelId ?? "",
      ambient: slackChannel?.ambient ?? false,
    },
  });

  const onSubmit = form.handleSubmit(async ({ channelId, ambient }) => {
    const connectPayload = {
      id: agent.id,
      slackChannelId: channelId,
      ...(ambient ? { ambient: true } : {}),
    };
    if (!slackChannel) {
      await connectSlack.mutateAsync(connectPayload);
    } else if (channelId !== slackChannel.slackChannelId) {
      // A channel change is a rebind: disconnect first so the old channel
      // gets a clean unbind before the new one is connected.
      await disconnectSlack.mutateAsync({ id: agent.id });
      await connectSlack.mutateAsync(connectPayload);
    } else if (ambient !== (slackChannel.ambient ?? false)) {
      // Ambient is the one mutable toggle: a same-channel re-connect updates
      // the existing binding in place.
      await connectSlack.mutateAsync(connectPayload);
    }
    onSaved();
  });

  return { form, editing, onSubmit };
}
