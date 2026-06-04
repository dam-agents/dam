import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronRight, ExternalLink, X } from "lucide-react";
import { useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { BOB_CHAT_MODES, type BobModelPins } from "../../../../types.js";
import { CardIcon } from "../shared/card-icon.js";
import { IconButton } from "../shared/icon-button.js";
import { MODES, stripWhitespace } from "./modes.js";

const bobCredentialSchema = z
  .object({
    value: z.string(),
    model: z.string(),
    agentId: z.string(),
    teamId: z.string(),
    maxCoins: z.string(),
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
      data.maxCoins.trim() !== "" &&
      !/^[1-9]\d*$/.test(data.maxCoins.trim())
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxCoins"],
        message: "Must be a positive integer",
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
  initialPins,
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  initialPins?: BobModelPins;
  onSave: (input: { value: string; pins: BobModelPins }) => Promise<void>;
  onCancel?: () => void;
}) {
  const pins = initialPins ?? {};
  const { register, handleSubmit, watch, formState } = useForm<FormValues>({
    resolver: zodResolver(bobCredentialSchema),
    mode: "onChange",
    defaultValues: {
      value: "",
      model: pins.model ?? "",
      agentId: pins.agentId ?? "",
      teamId: pins.teamId ?? "",
      maxCoins: pins.maxCoins ?? "",
      chatMode: pins.chatMode ?? "",
    },
  });
  const { errors, isSubmitting, isValid } = formState;
  const hasAnyPin = Object.values(pins).some((v) => v && v.trim() !== "");
  const [advancedOpen, setAdvancedOpen] = useState(
    variant === "edit" && hasAnyPin,
  );

  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;
  const value = watch("value");

  const onSubmit = handleSubmit(async (values) => {
    await onSave({
      value: stripWhitespace(values.value),
      pins: {
        model: values.model.trim() || undefined,
        agentId: values.agentId.trim() || undefined,
        teamId: values.teamId.trim() || undefined,
        maxCoins: values.maxCoins.trim() || undefined,
        chatMode: values.chatMode.trim() || undefined,
      },
    });
  });

  return (
    <Card className="anim-in">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <CardIcon provider="bob" />
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold text-foreground">
              Bob Shell
            </div>
            <div className="text-[12px] text-muted-foreground">
              {isEdit
                ? "Paste a new token to replace the existing one. Advanced settings are passed to Bob as CLI flags / env."
                : "IBM's AI shell assistant. Paste a Bob API key of type Inference to get started."}{" "}
              <a
                href="https://bob.ibm.com/admin/apikeys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1"
              >
                Manage keys <ExternalLink size={11} />
              </a>
            </div>
          </div>
          {onCancel && (
            <IconButton onClick={onCancel} title="Cancel" hoverTone="neutral">
              <X size={13} />
            </IconButton>
          )}
        </div>

        <div className="flex gap-3">
          <Input
            type="password"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            data-form-type="other"
            placeholder={MODES["api-key"].placeholder}
            {...register("value")}
          />
          <Button type="submit" disabled={submitDisabled} className="shrink-0">
            {isSubmitting ? "..." : isEdit ? "Replace" : "Save"}
          </Button>
        </div>

        {errors.value &&
          value.length > 0 &&
          errors.value.message !== "Required" && (
            <div className="text-[12px] font-medium text-destructive">
              {errors.value.message}
            </div>
          )}

        <button
          type="button"
          onClick={() => setAdvancedOpen((o) => !o)}
          className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground -mt-1 self-start"
        >
          {advancedOpen ? (
            <ChevronDown size={13} />
          ) : (
            <ChevronRight size={13} />
          )}
          Advanced — model & tenant scoping
        </button>

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
              hint="BOB_INSTANCE_ID → --instance-id. IBM tenant scoping for outbound API calls."
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
              label="Max coins"
              hint="BOB_MAX_COINS → --max-coins. Budget cap; Bob exits when exceeded."
              placeholder="(no cap)"
              error={errors.maxCoins?.message}
              register={register("maxCoins")}
            />
            <PinField
              label="Chat mode"
              hint={`BOB_CHAT_MODE → --chat-mode. One of: ${BOB_CHAT_MODES.join(", ")}.`}
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
      </form>
    </Card>
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
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-semibold text-foreground">
        {label}
      </label>
      <Input
        type="text"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        placeholder={placeholder}
        list={list}
        className="font-mono text-[13px]"
        {...register}
      />
      <div className="text-[11px] text-muted-foreground">{hint}</div>
      {error && (
        <div className="text-[11px] font-medium text-destructive">{error}</div>
      )}
    </div>
  );
}
