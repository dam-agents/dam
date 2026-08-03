import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { AgentView } from "../../../types.js";
import {
  useConnectSlack,
  useDisconnectSlack,
} from "../../agents/api/mutations.js";

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

/** Drives the connect/edit modal for a single Slack binding: `channel` is the
 *  one being edited, undefined when connecting a new one. An agent may hold
 *  several bindings, so every write here names its channel. */
export function useSlackChannelForm(
  agent: AgentView,
  channel: SlackChannel | undefined,
  onSaved: () => void,
) {
  const editing = !!channel;

  const connectSlack = useConnectSlack();
  const disconnectSlack = useDisconnectSlack();

  const form = useForm<SlackChannelFormValues>({
    resolver: zodResolver(slackChannelFormSchema),
    defaultValues: {
      channelId: channel?.slackChannelId ?? "",
      ambient: channel?.ambient ?? false,
    },
  });

  const onSubmit = form.handleSubmit(async ({ channelId, ambient }) => {
    const connectPayload = {
      id: agent.id,
      slackChannelId: channelId,
      ...(ambient ? { ambient: true } : {}),
    };
    if (!channel) {
      await connectSlack.mutateAsync(connectPayload);
    } else if (channelId !== channel.slackChannelId) {
      // A channel change is a rebind: disconnect the old channel — and only
      // that one — so it gets a clean unbind before the new one is connected.
      await disconnectSlack.mutateAsync({
        id: agent.id,
        slackChannelId: channel.slackChannelId,
      });
      await connectSlack.mutateAsync(connectPayload);
    } else if (ambient !== (channel.ambient ?? false)) {
      // Ambient is the one mutable toggle: a same-channel re-connect updates
      // the existing binding in place.
      await connectSlack.mutateAsync(connectPayload);
    }
    onSaved();
  });

  return { form, editing, onSubmit };
}
