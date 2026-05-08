import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PROVIDERS } from "../../../../types.js";
import { CardIcon } from "../shared/card-icon.js";
import { IconButton } from "../shared/icon-button.js";
import { MODES, stripWhitespace } from "./modes.js";

const OPENAI_DISPLAY_NAME = PROVIDERS.openai.displayName;

const openaiCredentialSchema = z
  .object({ value: z.string() })
  .superRefine((data, ctx) => {
    if (stripWhitespace(data.value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Required",
      });
    }
  });

type FormValues = z.infer<typeof openaiCredentialSchema>;

export function OpenAIForm({
  variant,
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  onSave: (input: { value: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const { register, handleSubmit, watch, formState } = useForm<FormValues>({
    resolver: zodResolver(openaiCredentialSchema),
    mode: "onChange",
    defaultValues: { value: "" },
  });
  const { errors, isSubmitting, isValid } = formState;

  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;
  const value = watch("value");

  const onSubmit = handleSubmit(async (values) => {
    await onSave({ value: stripWhitespace(values.value) });
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
          <div className="text-[15px] font-bold text-text">{OPENAI_DISPLAY_NAME}</div>
          <div className="text-[12px] text-text-muted">
            {isEdit
              ? "Paste a new API key to replace the existing one."
              : "Powers Codex agents and any harness that reads OPENAI_API_KEY."}
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
    </form>
  );
}
