import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { AgentView } from "../../../types.js";
import {
  useConnectSlack,
  useDisconnectSlack,
} from "../../agents/api/mutations.js";
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

/** Drives the connect/edit modal for a single Slack binding: `channel` is the
 *  one being edited, undefined when connecting a new one. */
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

  const onSubmit = form.handleSubmit(async (values) => {
    // Sequential by design: a step only runs once the one before it landed, so
    // a failure stops the save with the binding set still coherent.
    for (const step of planSlackChannelSave({
      agentId: agent.id,
      channel,
      values,
    })) {
      if (step.kind === "connect") await connectSlack.mutateAsync(step.input);
      else await disconnectSlack.mutateAsync(step.input);
    }
    onSaved();
  });

  return { form, editing, onSubmit };
}
