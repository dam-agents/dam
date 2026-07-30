import { Add, Close } from "@carbon/icons-react";
import { useState } from "react";
import type { Control } from "react-hook-form";
import { Controller, useFieldArray, useWatch } from "react-hook-form";

import { FormField } from "@/components/form-field";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../../types.js";
import type {
  SlackAccessMode,
  SlackChannelFormValues,
} from "../../hooks/use-slack-channel-form.js";
import { useSlackChannelForm } from "../../hooks/use-slack-channel-form.js";

const MODE_OPTIONS: {
  value: SlackAccessMode;
  label: string;
  description: string;
}[] = [
  {
    value: "person-scoped",
    label: "Person-scoped",
    description:
      "Each user links their own account; only the owner and allowed users drive the agent, each under their own credentials.",
  },
  {
    value: "shared",
    label: "Shared (system agent)",
    description:
      "Anyone in the channel drives the agent under the agent's credentials — no login. Turns are attributed by Slack user id, and your Terms-of-Use acceptance covers every turn.",
  },
];

export function SlackChannelModal({
  agent,
  onClose,
}: {
  agent: AgentView;
  onClose: () => void;
}) {
  const { form, editing, onSubmit } = useSlackChannelForm(agent, onClose);
  const {
    register,
    control,
    formState: { errors, isSubmitting },
  } = form;
  const mode = useWatch({ control, name: "mode" });

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
              className="h-[40px]"
              variant={errors.channelId ? "invalid" : undefined}
              aria-invalid={!!errors.channelId}
              placeholder="C0…"
              data-testid="slack-channel-id"
              {...register("channelId")}
            />
          </FormField>

          <AccessModePicker control={control} locked={editing} />

          {mode === "shared" && (
            <Controller
              control={control}
              name="ambient"
              render={({ field }) => (
                <AmbientRow checked={field.value} onChange={field.onChange} />
              )}
            />
          )}

          {mode === "person-scoped" && <AllowedUsers control={control} />}
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

function AccessModePicker({
  control,
  locked,
}: {
  control: Control<SlackChannelFormValues>;
  locked: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Access mode</SectionLabel>
      <Controller
        control={control}
        name="mode"
        render={({ field }) => (
          <RadioGroup
            aria-label="Access mode"
            value={field.value}
            onValueChange={field.onChange}
            onBlur={field.onBlur}
          >
            {MODE_OPTIONS.map((opt) => (
              <RadioGroupItem
                key={opt.value}
                value={opt.value}
                label={opt.label}
                description={opt.description}
                disabled={locked}
                aria-describedby={locked ? "slack-mode-locked" : undefined}
                className={cn(
                  "rounded-md border border-border bg-background px-3 py-2.5",
                  locked ? "opacity-60" : "cursor-pointer",
                )}
              />
            ))}
          </RadioGroup>
        )}
      />
      {locked && (
        <p id="slack-mode-locked" className="text-sm text-muted-foreground">
          The mode is fixed per binding — disconnect and reconnect to change it.
        </p>
      )}
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

function AllowedUsers({
  control,
}: {
  control: Control<SlackChannelFormValues>;
}) {
  const { fields, append, remove } = useFieldArray({ control, name: "users" });
  const [userInput, setUserInput] = useState("");

  const addUser = () => {
    const email = userInput.trim();
    if (!email || fields.some((f) => f.email === email)) return;
    append({ email });
    setUserInput("");
  };

  return (
    <div className="flex flex-col gap-2">
      <SectionLabel>Allowed users</SectionLabel>
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Unrestricted — any linked Slack user can interact.
        </p>
      )}
      {fields.map((field, index) => (
        <div
          key={field.id}
          className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5"
        >
          <span className="flex-1 truncate font-mono text-sm text-foreground">
            {field.email}
          </span>
          <Button
            type="button"
            variant="ghost"
            tone="danger"
            size="icon-xs"
            aria-label={`Remove ${field.email}`}
            onClick={() => remove(index)}
            className="shrink-0"
          >
            <Close size={14} />
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          type="email"
          className="h-[32px] flex-1"
          value={userInput}
          placeholder="user@example.com"
          onChange={(e) => setUserInput(e.target.value)}
          onKeyDown={(e) =>
            e.key === "Enter" && (e.preventDefault(), addUser())
          }
        />
        <Button
          type="button"
          variant="outline"
          className="h-[32px] px-3 text-sm font-normal"
          onClick={addUser}
          disabled={!userInput.trim()}
        >
          <Add size={16} />
          Add
        </Button>
      </div>
    </div>
  );
}
