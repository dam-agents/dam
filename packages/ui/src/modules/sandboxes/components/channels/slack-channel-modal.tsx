import { Controller } from "react-hook-form";

import { FormField } from "@/components/form-field";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  /** The binding being edited; omitted when connecting a new channel. */
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
          title={editing ? "Edit Slack channel" : "Connect a Slack channel"}
        />

        <DialogBody className="flex flex-col gap-4">
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

          <Controller
            control={control}
            name="ambient"
            render={({ field }) => (
              <AmbientRow checked={field.value} onChange={field.onChange} />
            )}
          />
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            data-testid="slack-save"
          >
            {isSubmitting ? "Saving…" : editing ? "Save" : "Connect"}
          </Button>
        </DialogFooter>
      </form>
    </Modal>
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
          mentioned when it can clearly help. The channel is notified when this
          changes, and it can be turned off anytime — here or with the in-chat
          ambient command.
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
