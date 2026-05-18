import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";

import { BOB_CHAT_MODES, type BobModelPins } from "../../../../types.js";
import { CardIcon } from "../shared/card-icon.js";
import { IconButton } from "../shared/icon-button.js";
import { MODES, stripWhitespace } from "./modes.js";

const bobCredentialSchema = z
  .object({
    value: z.string(),
    model: z.string(),
    instanceId: z.string(),
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
    // maxCoins is a numeric budget cap; reject anything that isn't a positive
    // integer when set. Empty is fine (Bob omits the flag).
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
      instanceId: pins.instanceId ?? "",
      teamId: pins.teamId ?? "",
      maxCoins: pins.maxCoins ?? "",
      chatMode: pins.chatMode ?? "",
    },
  });
  const { errors, isSubmitting, isValid } = formState;
  // Open the advanced disclosure by default in edit mode when any pin is set —
  // otherwise the user has to hunt for the model field they came to change.
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
        instanceId: values.instanceId.trim() || undefined,
        teamId: values.teamId.trim() || undefined,
        maxCoins: values.maxCoins.trim() || undefined,
        chatMode: values.chatMode.trim() || undefined,
      },
    });
  });

  return (
    <form
      onSubmit={onSubmit}
      className={`rounded-xl border-2 p-5 anim-in flex flex-col gap-4 ${
        isEdit
          ? "border-accent bg-accent-light shadow-brutal-accent"
          : "border-warning bg-warning-light shadow-brutal"
      }`}
    >
      <div className="flex items-center gap-3">
        <CardIcon variant={isEdit ? "accent" : "warning"} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text">Bob Shell</div>
          <div className="text-[12px] text-text-muted">
            {isEdit
              ? "Paste a new token to replace the existing one. Advanced settings are passed to Bob as CLI flags / env."
              : "IBM's AI shell assistant. Paste your Bob API key to get started."}
          </div>
        </div>
        {onCancel && (
          <IconButton onClick={onCancel} title="Cancel" hoverTone="neutral">
            <X size={13} />
          </IconButton>
        )}
      </div>

      <div className="flex gap-3">
        <input
          className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted"
          type="password"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          placeholder={MODES["api-key"].placeholder}
          {...register("value")}
        />
        <button
          type="submit"
          className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white disabled:opacity-40 shrink-0 shadow-brutal-accent"
          disabled={submitDisabled}
        >
          {isSubmitting ? "..." : isEdit ? "Replace" : "Save"}
        </button>
      </div>

      {errors.value &&
        value.length > 0 &&
        errors.value.message !== "Required" && (
          <div className="text-[12px] font-medium text-danger">
            {errors.value.message}
          </div>
        )}

      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[12px] font-semibold text-text-muted hover:text-text -mt-1 self-start"
      >
        {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
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
            error={errors.instanceId?.message}
            register={register("instanceId")}
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
      <label className="text-[12px] font-semibold text-text-secondary">
        {label}
      </label>
      <input
        className="h-9 rounded-lg border-2 border-border-light bg-bg px-3 text-[13px] font-mono text-text outline-none focus:border-accent"
        type="text"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        placeholder={placeholder}
        list={list}
        {...register}
      />
      <div className="text-[11px] text-text-muted">{hint}</div>
      {error && (
        <div className="text-[11px] font-medium text-danger">{error}</div>
      )}
    </div>
  );
}
