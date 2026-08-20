import { Controller } from "react-hook-form";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";

import type { AgentView } from "../../../../types.js";
import type { SlackChannel } from "../../hooks/use-slack-channel-form.js";
import { useSlackChannelForm } from "../../hooks/use-slack-channel-form.js";

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
    formState: { errors, isSubmitting },
  } = form;

  return (
    <Modal>
      <form onSubmit={onSubmit} className="flex min-h-0 flex-col">
        <DialogHeader
          title={editing ? "Slack channel settings" : "Connect a Slack channel"}
          onClose={onClose}
          closeDisabled={isSubmitting}
        />

        <DialogBody className="flex flex-col gap-4">
          {channel ? (
            <ConnectedChannel slackChannelId={channel.slackChannelId} />
          ) : (
            <FormField
              label="Channel ID"
              disableInset
              error={errors.channelId?.message}
              hint="From the channel's details in Slack — starts with C. The bot must be a member of the channel."
            >
              <Input
                className="h-10"
                variant={errors.channelId ? "invalid" : undefined}
                aria-invalid={!!errors.channelId}
                placeholder="C0…"
                data-testid="slack-channel-id"
                {...register("channelId")}
              />
            </FormField>
          )}

          <Controller
            control={control}
            name="ambient"
            render={({ field }) => (
              <AmbientRow checked={field.value} onChange={field.onChange} />
            )}
          />
        </DialogBody>

        <DialogActions
          onCancel={onClose}
          label={editing ? "Save" : "Connect"}
          pendingLabel={editing ? "Saving…" : "Connecting…"}
          pending={isSubmitting}
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

function AmbientRow({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-foreground">
          Ambient mode
        </span>
        <span className="text-sm text-muted-foreground">
          The agent reads along in the channel and may chime in without being
          mentioned when it can clearly help. It is set per agent, so other
          agents in the channel are unaffected, and it can be turned off anytime
          — here or with the in-chat ambient command.
        </span>
      </span>
      <Switch
        className="mt-0.5"
        checked={checked}
        onCheckedChange={onChange}
        label="Ambient mode"
      />
    </div>
  );
}
