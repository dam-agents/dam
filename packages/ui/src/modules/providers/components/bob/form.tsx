import { Launch } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import {
  Controller,
  useForm,
  type UseFormRegisterReturn,
} from "react-hook-form";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { DisclosureToggle } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { externalLinkProps } from "@/lib/external-link";

import { BOB_CHAT_MODES, type BobModelPins } from "../../../../types.js";
import { ProviderFormShell } from "../provider-form-shell.js";
import { type Mode, MODE_KEYS, MODES, stripWhitespace } from "./modes.js";

const MODE_TABS: readonly TabDef<Mode>[] = MODE_KEYS.map((mode) => ({
  value: mode,
  label: MODES[mode].label,
}));

const bobCredentialSchema = z
  .object({
    mode: z.enum(MODE_KEYS),
    value: z.string(),
    model: z.string(),
    agentId: z.string(),
    teamId: z.string(),
    maxCost: z.string(),
    chatMode: z.string(),
  })
  .superRefine((data, ctx) => {
    if (stripWhitespace(data.value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Required",
      });
    }
    if (
      data.maxCost.trim() !== "" &&
      !/^(?:[1-9]\d*(?:\.\d+)?|0?\.\d*[1-9]\d*)$/.test(data.maxCost.trim())
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCost"],
        message: "Must be a positive amount, e.g. 0.50 or 5",
      });
    }
    const cm = data.chatMode.trim();
    if (
      cm !== "" &&
      !BOB_CHAT_MODES.includes(cm as (typeof BOB_CHAT_MODES)[number])
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["chatMode"],
        message: `Must be one of: ${BOB_CHAT_MODES.join(", ")}`,
      });
    }
  });

type FormValues = z.infer<typeof bobCredentialSchema>;

export function BobForm({
  variant,
  initialMode,
  lockMode = false,
  initialPins,
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  initialMode: Mode;
  lockMode?: boolean;
  initialPins?: BobModelPins;
  onSave: (input: {
    mode: Mode;
    value: string;
    pins: BobModelPins;
  }) => Promise<void>;
  onCancel?: () => void;
}) {
  const pins = initialPins ?? {};
  const { register, handleSubmit, control, watch, formState } =
    useForm<FormValues>({
      resolver: zodResolver(bobCredentialSchema),
      mode: "onChange",
      defaultValues: {
        mode: initialMode,
        value: "",
        model: pins.model ?? "",
        agentId: pins.agentId ?? "",
        teamId: pins.teamId ?? "",
        maxCost: pins.maxCost ?? "",
        chatMode: pins.chatMode ?? "",
      },
    });
  const { errors, isSubmitting, isValid } = formState;
  const hasAnyPin = Object.values(pins).some((v) => v && v.trim() !== "");
  const [advancedOpen, setAdvancedOpen] = useState(
    variant === "edit" && hasAnyPin,
  );

  const mode = watch("mode");
  const isShell = mode === "api-key";
  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;

  const onSubmit = handleSubmit(async (values) => {
    await onSave({
      mode: values.mode,
      value: stripWhitespace(values.value),
      pins:
        values.mode === "api-key"
          ? {
              model: values.model.trim() || undefined,
              agentId: values.agentId.trim() || undefined,
              teamId: values.teamId.trim() || undefined,
              maxCost: values.maxCost.trim() || undefined,
              chatMode: values.chatMode.trim() || undefined,
            }
          : {},
    });
  });

  return (
    <ProviderFormShell
      provider="bob"
      title="Bob"
      description={
        <>
          {isEdit
            ? "Paste a new token to replace the existing one."
            : isShell
              ? "IBM's AI shell assistant. Paste a Bob API key of type Inference to get started."
              : "Claude models through Bob, for Claude Code agents. Paste a Bob API key of type Inference to get started."}{" "}
          <a
            href="https://bob.ibm.com/admin/apikeys"
            {...externalLinkProps}
            className="text-primary hover:underline inline-flex items-center gap-1"
          >
            Manage keys <Launch size={11} />
          </a>
        </>
      }
      onSubmit={onSubmit}
      onCancel={onCancel}
    >
      {lockMode ? (
        <div className="flex items-center gap-4 border-b border-border">
          <span className="-mb-px flex h-10 items-center border-b-2 border-foreground px-4 text-sm font-medium text-foreground">
            {MODES[initialMode].label}
          </span>
        </div>
      ) : (
        <Controller
          control={control}
          name="mode"
          render={({ field }) => (
            <Tabs
              ariaLabel="Credential mode"
              tabs={MODE_TABS}
              value={field.value}
              onValueChange={field.onChange}
              size="sm"
            />
          )}
        />
      )}

      <div className="flex gap-3">
        <Input
          type="password"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          placeholder={MODES[mode].placeholder}
          {...register("value")}
        />
        <Button type="submit" disabled={submitDisabled} className="shrink-0">
          {isSubmitting ? "..." : isEdit ? "Replace" : "Save"}
        </Button>
      </div>

      {!isShell && (
        <div className="text-sm text-muted-foreground">
          Points Claude Code at Bob&rsquo;s Anthropic Messages route. Pick the
          model per agent from the model picker.
        </div>
      )}

      {isShell && (
        <>
          <DisclosureToggle
            open={advancedOpen}
            onToggle={() => setAdvancedOpen((o) => !o)}
            chevronSize={13}
            className="gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground -mt-1 self-start"
          >
            Advanced — model & tenant scoping
          </DisclosureToggle>

          {advancedOpen && (
            <div className="grid grid-cols-1 gap-3">
              <PinField
                label="Model"
                hint="BOB_SHELL_MODEL — empty → Bob's built-in default."
                placeholder="premium-shell"
                error={errors.model?.message}
                register={register("model")}
              />
              <PinField
                label="Instance ID"
                hint="BOB_INSTANCE_ID → --instance-id. IBM tenant scoping; applies to terminal (TUI) sessions, chat sessions ignore it."
                error={errors.agentId?.message}
                register={register("agentId")}
              />
              <PinField
                label="Team ID"
                hint="BOB_TEAM_ID → --team-id."
                error={errors.teamId?.message}
                register={register("teamId")}
              />
              <PinField
                label="Max cost"
                hint="BOB_MAX_COINS → --max-cost. Per-task cost cap; Bob stops the task when exceeded."
                placeholder="(no cap)"
                error={errors.maxCost?.message}
                register={register("maxCost")}
              />
              <PinField
                label="Mode"
                hint={`BOB_CHAT_MODE → --mode. One of: ${BOB_CHAT_MODES.join(", ")}.`}
                placeholder="(Bob default)"
                list="bob-chat-modes"
                error={errors.chatMode?.message}
                register={register("chatMode")}
              />
              <datalist id="bob-chat-modes">
                {BOB_CHAT_MODES.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
          )}
        </>
      )}
    </ProviderFormShell>
  );
}

function PinField({
  label,
  hint,
  placeholder,
  list,
  error,
  register,
}: {
  label: string;
  hint: string;
  placeholder?: string;
  list?: string;
  error?: string;
  register: UseFormRegisterReturn;
}) {
  return (
    <FormField label={label} hint={hint} error={error}>
      <Input
        type="text"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        placeholder={placeholder}
        list={list}
        className="font-mono text-sm"
        {...register}
      />
    </FormField>
  );
}
