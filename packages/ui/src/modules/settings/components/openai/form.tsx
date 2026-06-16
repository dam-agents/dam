import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { PROVIDERS } from "../../../../types.js";
import { ProviderFormShell } from "../shared/provider-form-shell.js";
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
    <ProviderFormShell
      provider="openai"
      title={OPENAI_DISPLAY_NAME}
      description={
        isEdit
          ? "Paste a new API key to replace the existing one."
          : "Powers Codex agents and any harness that reads OPENAI_API_KEY."
      }
      onSubmit={onSubmit}
      onCancel={onCancel}
    >
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
    </ProviderFormShell>
  );
}
