import { zodResolver } from "@hookform/resolvers/zod";
import type { SlackChannel } from "api-server-api";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { getBrand } from "../../../brand.js";
import type { AgentView } from "../../../types.js";
import { useConnectSlack } from "../../agents/api/mutations.js";
import { useBindSharingConfirm } from "../../agents/hooks/use-bind-sharing-confirm.js";
import { useProfiles } from "../../profiles/api/queries.js";
import {
  defaultProfileId,
  newestFirst,
  newestProfileId,
} from "../../profiles/lib/default-profile.js";
import { useSessionDefaults } from "../../sessions/api/session-pair.js";
import { useSetChannelProfile } from "../api/channel-profile.js";
import { isSlackDirectMessageId } from "../lib/shared-channels.js";
import { planSlackChannelSave } from "../lib/slack-channel-save.js";

export type { SlackChannel };

const slackChannelFormSchema = z
  .object({
    channelId: z.string().trim().min(1, "Enter the Slack channel ID."),
    ambient: z.boolean(),
    customEmojiEnabled: z.boolean(),
    customEmoji: z.array(z.string()),
    profile: z.string(),
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
  const setChannelProfile = useSetChannelProfile(agent.id);
  const bindConfirm = useBindSharingConfirm(editing ? null : agent);
  const { data: profiles = [] } = useProfiles(agent.id);
  const chatProfileId =
    useSessionDefaults(agent.id).data?.chatProfileId ?? null;
  /* UNIT_BOUNDARY_DESCRIPTION: a new channel starts on the profile the newest
   * channel of this agent runs on, else the chat profile (D91); the field is
   * the one place the pick is made for a binding, so the row never opens
   * without one. */
  const preselected =
    editing || profiles.length === 0
      ? null
      : defaultProfileId({
          profiles,
          newestProfileId: newestProfileId(newestFirst(agent.channels)),
          chatProfileId,
        });

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
      profile: "",
    },
  });

  /* UNIT_BOUNDARY_DESCRIPTION: the preselection arrives with the profiles, so
   * it is written once they are here — and never over a pick already made. */
  useEffect(() => {
    if (preselected === null || form.getValues("profile") !== "") return;
    form.setValue("profile", preselected);
  }, [preselected, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    const audience =
      editing || isSlackDirectMessageId(values.channelId)
        ? null
        : { kind: "slack-channel" as const, name: null };
    if (!(await bindConfirm.confirm(audience, "Connect", agent.whisper)))
      return;
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
    if (!editing && values.profile !== "")
      setChannelProfile.mutate({
        type: "slack",
        slackChannelId: values.channelId.trim(),
        profileId: values.profile,
      });
    onSaved();
  });

  return { form, editing, onSubmit };
}
