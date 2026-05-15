import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";

import {
  IBM_LITELLM_DEFAULT_MODEL_PINS,
  type IbmLitellmModelPins,
} from "../../../../types.js";
import { CardIcon } from "../shared/card-icon.js";
import { IconButton } from "../shared/icon-button.js";
import { MODES, stripWhitespace } from "./modes.js";

const ibmLitellmCredentialSchema = z
  .object({
    value: z.string(),
    modelOpus: z.string().min(1, "Required"),
    modelSonnet: z.string().min(1, "Required"),
    modelHaiku: z.string().min(1, "Required"),
    modelSubagent: z.string().min(1, "Required"),
    modelDefault: z.string().min(1, "Required"),
  })
  .superRefine((data, ctx) => {
    // Strip whitespace before checking emptiness (Q11=B): paste-from-terminal
    // newlines would otherwise satisfy a naive non-empty check while making
    // the wire token broken.
    if (stripWhitespace(data.value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Required",
      });
    }
  });

type FormValues = z.infer<typeof ibmLitellmCredentialSchema>;

export function IbmLitellmForm({
  variant,
  initialPins,
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  initialPins?: IbmLitellmModelPins;
  onSave: (input: { value: string; pins: IbmLitellmModelPins }) => Promise<void>;
  onCancel?: () => void;
}) {
  const pins = initialPins ?? IBM_LITELLM_DEFAULT_MODEL_PINS;
  const { register, handleSubmit, watch, formState } = useForm<FormValues>({
    resolver: zodResolver(ibmLitellmCredentialSchema),
    mode: "onChange",
    defaultValues: {
      value: "",
      modelOpus: pins.opus,
      modelSonnet: pins.sonnet,
      modelHaiku: pins.haiku,
      modelSubagent: pins.subagent,
      modelDefault: pins.default,
    },
  });
  const { errors, isSubmitting, isValid } = formState;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;
  const value = watch("value");

  const onSubmit = handleSubmit(async (values) => {
    await onSave({
      value: stripWhitespace(values.value),
      pins: {
        opus: values.modelOpus,
        sonnet: values.modelSonnet,
        haiku: values.modelHaiku,
        subagent: values.modelSubagent,
        default: values.modelDefault,
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
          <div className="text-[15px] font-bold text-text">IBM LiteLLM ETE Proxy</div>
          <div className="text-[12px] text-text-muted">
            {isEdit
              ? "Paste a new token to replace the existing one. Model overrides apply to both Claude Code and pi-agent."
              : "Routes Claude Code and pi-agent through IBM's internal LiteLLM proxy. Paste your LiteLLM API token."}
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

      {errors.value && value.length > 0 && errors.value.message !== "Required" && (
        <div className="text-[12px] font-medium text-danger">{errors.value.message}</div>
      )}

      <button
        type="button"
        onClick={() => setAdvancedOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[12px] font-semibold text-text-muted hover:text-text -mt-1 self-start"
      >
        {advancedOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Advanced — model overrides
      </button>

      {advancedOpen && (
        <div className="grid grid-cols-1 gap-3">
          <ModelField
            label="Opus model"
            hint="ANTHROPIC_DEFAULT_OPUS_MODEL — also drives OPENAI_PROXY_MODEL for pi-agent."
            error={errors.modelOpus?.message}
            register={register("modelOpus")}
          />
          <ModelField
            label="Sonnet model"
            hint="ANTHROPIC_DEFAULT_SONNET_MODEL"
            error={errors.modelSonnet?.message}
            register={register("modelSonnet")}
          />
          <ModelField
            label="Haiku model"
            hint="ANTHROPIC_DEFAULT_HAIKU_MODEL"
            error={errors.modelHaiku?.message}
            register={register("modelHaiku")}
          />
          <ModelField
            label="Subagent model"
            hint="CLAUDE_CODE_SUBAGENT_MODEL"
            error={errors.modelSubagent?.message}
            register={register("modelSubagent")}
          />
          <ModelField
            label="Default model"
            hint="ANTHROPIC_MODEL — fallback when no DEFAULT_*_MODEL matches."
            error={errors.modelDefault?.message}
            register={register("modelDefault")}
          />
        </div>
      )}
    </form>
  );
}

function ModelField({
  label,
  hint,
  error,
  register,
}: {
  label: string;
  hint: string;
  error?: string;
  register: UseFormRegisterReturn;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[12px] font-semibold text-text-secondary">{label}</label>
      <input
        className="h-9 rounded-lg border-2 border-border-light bg-bg px-3 text-[13px] font-mono text-text outline-none focus:border-accent"
        type="text"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        {...register}
      />
      <div className="text-[11px] text-text-muted">{hint}</div>
      {error && <div className="text-[11px] font-medium text-danger">{error}</div>}
    </div>
  );
}
