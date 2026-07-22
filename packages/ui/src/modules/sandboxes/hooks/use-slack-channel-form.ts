import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import type { AgentView } from "../../../types.js";
import {
  useConnectSlack,
  useDisconnectSlack,
  useUpdateAgent,
} from "../../agents/api/mutations.js";

type SlackChannel = Extract<AgentView["channels"][number], { type: "slack" }>;

export const slackChannelFormSchema = z.object({
  channelId: z.string().trim().min(1, "Enter the Slack channel ID."),
  mode: z.enum(["person-scoped", "shared"]),
  ambient: z.boolean(),
  users: z.array(z.object({ email: z.string() })),
});

export type SlackChannelFormValues = z.infer<typeof slackChannelFormSchema>;
export type SlackAccessMode = SlackChannelFormValues["mode"];

export function findSlackChannel(
  agent: AgentView | undefined,
): SlackChannel | undefined {
  return agent?.channels.find((c): c is SlackChannel => c.type === "slack");
}

/** RHF form for the connect/edit Slack modal, seeded from the current
 *  binding. Submitting orchestrates connect / rebind / ambient update plus
 *  the allowed-users patch, then reports completion via `onSaved`. */
export function useSlackChannelForm(agent: AgentView, onSaved: () => void) {
  const slackChannel = findSlackChannel(agent);
  const editing = !!slackChannel;

  const connectSlack = useConnectSlack();
  const disconnectSlack = useDisconnectSlack();
  const updateAgent = useUpdateAgent();

  const form = useForm<SlackChannelFormValues>({
    resolver: zodResolver(slackChannelFormSchema),
    defaultValues: {
      channelId: slackChannel?.slackChannelId ?? "",
      mode: slackChannel?.mode ?? "person-scoped",
      ambient: slackChannel?.ambient ?? false,
      users: agent.allowedUserEmails.map((email) => ({ email })),
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const { channelId, mode, ambient } = values;
    const connectPayload = {
      id: agent.id,
      slackChannelId: channelId,
      ...(mode === "shared" ? { mode } : {}),
      ...(mode === "shared" && ambient ? { ambient: true } : {}),
    };
    if (!slackChannel) {
      await connectSlack.mutateAsync(connectPayload);
    } else if (channelId !== slackChannel.slackChannelId) {
      // The mode is fixed per binding, so a channel change is a rebind.
      await disconnectSlack.mutateAsync({ id: agent.id });
      await connectSlack.mutateAsync(connectPayload);
    } else if (
      mode === "shared" &&
      ambient !== (slackChannel.ambient ?? false)
    ) {
      // Ambient is mutable (unlike mode): a same-mode re-connect updates
      // the existing binding in place.
      await connectSlack.mutateAsync(connectPayload);
    }
    await updateAgent.mutateAsync({
      id: agent.id,
      allowedUserEmails: values.users.map((u) => u.email),
    });
    onSaved();
  });

  return { form, editing, onSubmit };
}
