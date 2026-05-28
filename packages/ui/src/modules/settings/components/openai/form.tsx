import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

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
    <Card className="anim-in">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <CardIcon provider="openai" />
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold text-foreground">
              {OPENAI_DISPLAY_NAME}
            </div>
            <div className="text-[12px] text-muted-foreground">
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
      </form>
    </Card>
  );
}
