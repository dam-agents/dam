import { zodResolver } from "@hookform/resolvers/zod";
import type { SlackChannel } from "api-server-api";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { getBrand } from "../../../brand.js";
import { getErrorMessage } from "../../../lib/errors.js";
import { emitToast } from "../../../lib/toast.js";
import type { AgentView } from "../../../types.js";
import { useConnectSlack } from "../../agents/api/mutations.js";
import { useBindSharingConfirm } from "../../agents/hooks/use-bind-sharing-confirm.js";
import { useProfiles } from "../../profiles/api/queries.js";
import { defaultProfileId } from "../../profiles/lib/default-profile.js";
import { useSessionDefaults } from "../../sessions/api/session-pair.js";
import { useSetChannelProfile } from "../api/channel-profile.js";
import { isSlackDirectMessageId } from "../lib/shared-channels.js";
import { planSlackChannelSave } from "../lib/slack-channel-save.js";

export type { SlackChannel };

const slackChannelFormSchema = (editing: boolean) =>
  z
    .object({
      channelIds: z.array(z.string()),
      ambient: z.boolean(),
      customEmojiEnabled: z.boolean(),
      customEmoji: z.array(z.string()),
      profile: z.string(),
    })
    .superRefine((values, ctx) => {
      if (!editing && values.channelIds.length === 0)
        ctx.addIssue({
          code: "custom",
          path: ["channelIds"],
          message: "Pick a channel.",
        });
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

type SlackChannelFormValues = z.infer<
  ReturnType<typeof slackChannelFormSchema>
>;

export function useSlackChannelForm(
  agent: AgentView,
  channel: SlackChannel | undefined,
  onSaved: () => void,
) {
  const editing = !!channel;

  const connectSlack = useConnectSlack();
  const setChannelProfile = useSetChannelProfile(agent.id);
  const bindConfirm = useBindSharingConfirm(editing ? null : agent);
  const { data: profiles = [] } = useProfiles(agent.id);
  const chatProfileId =
    useSessionDefaults(agent.id).data?.chatProfileId ?? null;
  const preselected = editing
    ? null
    : defaultProfileId(profiles, [
        agent.channels
          .filter((c) => c.profileId)
          .sort((a, b) =>
            (b.createdAt ?? "").localeCompare(a.createdAt ?? ""),
          )[0]?.profileId,
        chatProfileId,
      ]);

  const form = useForm<SlackChannelFormValues>({
    resolver: zodResolver(slackChannelFormSchema(editing)),
    defaultValues: {
      channelIds: [],
      ambient: channel?.ambient ?? false,
      customEmojiEnabled: !!channel?.customEmoji,
      customEmoji:
        channel?.customEmoji ??
        Array.from(
          { length: 8 },
          (_, i) => `${getBrand().short}-agent-${i + 1}`,
        ),
      profile: "",
    },
  });

  useEffect(() => {
    if (preselected === null || form.getValues("profile") !== "") return;
    form.setValue("profile", preselected);
  }, [preselected, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    const channelIds = channel ? [channel.slackChannelId] : values.channelIds;
    const audience =
      editing || channelIds.every(isSlackDirectMessageId)
        ? null
        : { kind: "slack-channel" as const, name: null };
    if (!(await bindConfirm.confirm(audience, "Connect", agent.whisper)))
      return;
    const customEmoji = values.customEmojiEnabled
      ? values.customEmoji.map((n) => n.trim().replace(/^:|:$/g, ""))
      : null;
    for (const channelId of channelIds) {
      const connect = planSlackChannelSave({
        agentId: agent.id,
        channel,
        values: { channelId, ambient: values.ambient, customEmoji },
      });
      if (connect) await connectSlack.mutateAsync(connect);
      if (!channel && values.profile)
        await setChannelProfile
          .mutateAsync({
            type: "slack",
            slackChannelId: channelId,
            profileId: values.profile,
          })
          .catch((err: unknown) =>
            emitToast({
              kind: "error",
              message: `The channel is connected, but its profile couldn't be set: ${getErrorMessage(err, "try again from the channel's row.")}`,
            }),
          );
      if (!channel)
        form.setValue(
          "channelIds",
          form.getValues("channelIds").filter((id) => id !== channelId),
        );
    }
    onSaved();
  });

  return { form, editing, onSubmit };
}
