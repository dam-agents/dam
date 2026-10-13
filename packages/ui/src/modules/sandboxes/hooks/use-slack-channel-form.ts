import { zodResolver } from "@hookform/resolvers/zod";
import type { SlackChannel } from "api-server-api";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { getBrand } from "../../../brand.js";
import type { AgentView } from "../../../types.js";
import { useConnectSlack } from "../../agents/api/mutations.js";
import { useBindSharingConfirm } from "../../agents/hooks/use-bind-sharing-confirm.js";
import { isSlackDirectMessageId } from "../lib/shared-channels.js";
import { planSlackChannelSave } from "../lib/slack-channel-save.js";

export type { SlackChannel };

const slackChannelFormSchema = z
  .object({
    channelId: z.string().trim().min(1, "Enter the Slack channel ID."),
    ambient: z.boolean(),
    customEmojiEnabled: z.boolean(),
    customEmoji: z.array(z.string()),
  })
  .superRefine((values, ctx) => {
    if (!values.customEmojiEnabled) return;
    values.customEmoji.forEach((name, i) => {
      if (!/^:?[a-z0-9_'+-]{1,100}:?$/.test(name.trim()))
        ctx.addIssue({
          code: "custom",
          path: ["customEmoji", i],
          message:
            "Use the emoji's name: lowercase letters, digits, - _ + or '.",
        });
    });
  });

type SlackChannelFormValues = z.infer<typeof slackChannelFormSchema>;

export function useSlackChannelForm(
  agent: AgentView,
  channel: SlackChannel | undefined,
  onSaved: () => void,
) {
  const editing = !!channel;

  const connectSlack = useConnectSlack();
  const bindConfirm = useBindSharingConfirm(editing ? null : agent);

  const form = useForm<SlackChannelFormValues>({
    resolver: zodResolver(slackChannelFormSchema),
    defaultValues: {
      channelId: channel?.slackChannelId ?? "",
      ambient: channel?.ambient ?? false,
      customEmojiEnabled: !!channel?.customEmoji,
      customEmoji:
        channel?.customEmoji ??
        Array.from(
          { length: 8 },
          (_, i) => `${getBrand().short}-agent-${i + 1}`,
        ),
    },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    const audience =
      editing || isSlackDirectMessageId(values.channelId)
        ? null
        : { kind: "slack-channel" as const, name: null };
    if (!(await bindConfirm.confirm(audience, "Connect"))) return;
    const connect = planSlackChannelSave({
      agentId: agent.id,
      channel,
      values: {
        ...values,
        customEmoji: values.customEmojiEnabled
          ? values.customEmoji.map((n) => n.trim().replace(/^:|:$/g, ""))
          : null,
      },
    });
    if (connect) await connectSlack.mutateAsync(connect);
    onSaved();
  });

  return { form, editing, onSubmit };
}
