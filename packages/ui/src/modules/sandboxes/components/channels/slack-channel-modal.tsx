import {
  AVATAR_CHARACTERS,
  SLACK_EMOJI_INDEX,
} from "api-server-api/avatar/svg";
import { Controller } from "react-hook-form";

import { FormError } from "@/components/form-error";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";
import { ToggleRow } from "@/components/ui/toggle-row";

import { getBrand } from "../../../../brand.js";
import type { AgentView } from "../../../../types.js";
import { AgentAvatar } from "../../../agents/components/avatar/agent-avatar.js";
import { SlackChannelPicker } from "../../../slack/components/slack-channel-picker.js";
import type { SlackChannel } from "../../hooks/use-slack-channel-form.js";
import { useSlackChannelForm } from "../../hooks/use-slack-channel-form.js";
import { ChannelSwitchCard } from "./channel-switch-card.js";

export function SlackChannelModal({
  agent,
  channel,
  onClose,
}: {
  agent: AgentView;
  channel?: SlackChannel;
  onClose: () => void;
}) {
  const { form, editing, onSubmit } = useSlackChannelForm(
    agent,
    channel,
    onClose,
  );
  const {
    register,
    control,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  return (
    <Modal onClose={isSubmitting ? undefined : onClose}>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
        <DialogHeader
          title={editing ? "Slack channel settings" : "Connect Slack channels"}
          onClose={onClose}
          closeDisabled={isSubmitting}
        />

        <DialogBody className="flex flex-col gap-4">
          {channel ? (
            <ConnectedChannel slackChannelId={channel.slackChannelId} />
          ) : (
            <div className="flex flex-col gap-2">
              <Controller
                control={control}
                name="channelIds"
                render={({ field }) => (
                  <SlackChannelPicker
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              <FormError message={errors.channelIds?.message} />
            </div>
          )}

          <Controller
            control={control}
            name="ambient"
            render={({ field }) => (
              <ChannelSwitchCard
                label="Ambient mode"
                checked={field.value}
                onChange={field.onChange}
              >
                The agent reads along in the channel and may chime in without
                being mentioned when it can clearly help. It is set per agent,
                so other agents in the channel are unaffected, and it can be
                turned off anytime — here or with the in-chat ambient command.
              </ChannelSwitchCard>
            )}
          />

          <div className="flex w-full flex-col gap-3 rounded-md border border-border bg-background px-3 py-2.5">
            <ToggleRow
              className="gap-3"
              title="Use custom emoji for agents"
              description="Where the Slack app can't post under the agent's own name and avatar, each post opens with an emoji and the agent's name. Without custom emoji that is a robot face. Name the workspace's emoji for each avatar."
              control={
                <Controller
                  control={control}
                  name="customEmojiEnabled"
                  render={({ field }) => (
                    <Switch
                      className="mt-0.5"
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      label="Use custom emoji for agents"
                    />
                  )}
                />
              }
            />
            {watch("customEmojiEnabled") && (
              <div
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                data-testid="slack-custom-emoji"
              >
                {[...AVATAR_CHARACTERS]
                  .sort((a, b) => SLACK_EMOJI_INDEX[a] - SLACK_EMOJI_INDEX[b])
                  .map((character) => {
                    const i = SLACK_EMOJI_INDEX[character];
                    const error = errors.customEmoji?.[i]?.message;
                    return (
                      <div key={character} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <AgentAvatar name="" avatar={character} size={28} />
                          <Input
                            variant={error ? "invalid" : undefined}
                            aria-invalid={!!error}
                            aria-label={`Emoji for the ${character} avatar`}
                            {...register(`customEmoji.${i}`)}
                          />
                        </div>
                        {error && (
                          <span className="text-sm text-destructive">
                            {error}
                          </span>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
          {!channel && (
            <p className="text-sm text-muted-foreground">
              For a direct message, open a DM with @{getBrand().name} in Slack
              and run <code>/{getBrand().short} bind</code>.
            </p>
          )}
        </DialogBody>

        <DialogActions
          onCancel={onClose}
          label={editing ? "Save" : "Connect"}
          pendingLabel={editing ? "Saving…" : "Connecting…"}
          pending={isSubmitting}
          disabled={!channel && watch("channelIds").length === 0}
          cancelDisabled={isSubmitting}
          testId="slack-save"
        />
      </form>
    </Modal>
  );
}

function ConnectedChannel({ slackChannelId }: { slackChannelId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <SectionLabel>Channel</SectionLabel>
      <p
        className="font-mono text-sm text-foreground"
        data-testid="slack-channel-bound"
      >
        {slackChannelId}
      </p>
      <p className="text-sm text-muted-foreground">
        A connected channel can't be swapped for another one. To reach this
        agent from somewhere else, connect that channel and disconnect this one.
      </p>
    </div>
  );
}
