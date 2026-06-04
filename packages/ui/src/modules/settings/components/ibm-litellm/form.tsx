import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
    modelOpenai: z.string().min(1, "Required"),
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
  onSave: (input: {
    value: string;
    pins: IbmLitellmModelPins;
  }) => Promise<void>;
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
      modelOpenai: pins.openaiModel,
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
        openaiModel: values.modelOpenai,
      },
    });
  });

  return (
    <Card className="anim-in">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <CardIcon provider="ibm-litellm" />
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold text-foreground">
              IBM LiteLLM ETE Proxy
            </div>
            <div className="text-[12px] text-muted-foreground">
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
    </Card>
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
      <label className="text-[12px] font-semibold text-foreground/80">
        {label}
      </label>
      <Input
        type="text"
        className="font-mono text-[13px]"
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        {...register}
      />
      <div className="text-[11px] text-muted-foreground">{hint}</div>
      {error && (
        <div className="text-[11px] font-medium text-destructive">{error}</div>
      )}
    </div>
  );
}
