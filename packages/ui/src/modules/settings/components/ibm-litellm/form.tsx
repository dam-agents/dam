import { Launch } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { CardIcon } from "../shared/card-icon.js";
import { IconButton } from "../shared/icon-button.js";
import { MODES, stripWhitespace } from "./modes.js";

const KEY_GUIDE_URL =
  "https://pages.github.ibm.com/dam-agents/docs/guides/litellm-key/";

const ibmLitellmCredentialSchema = z
  .object({ value: z.string() })
  .superRefine((data, ctx) => {
    // Strip whitespace before checking emptiness: paste-from-terminal newlines
    // would otherwise satisfy a naive non-empty check while breaking the token.
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
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  onSave: (input: { value: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(ibmLitellmCredentialSchema),
    mode: "onChange",
    defaultValues: { value: "" },
  });
  const { isSubmitting, isValid } = formState;

  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;

  const onSubmit = handleSubmit(async (values) => {
    await onSave({ value: stripWhitespace(values.value) });
  });

  return (
    <Card className="anim-in">
      <form onSubmit={onSubmit} className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-3">
          <CardIcon provider="ibm-litellm" size="lg" />
          <div className="flex-1 min-w-0">
            <div className="text-[18px] font-bold text-foreground">
              IBM LiteLLM ETE Proxy
            </div>
            <div className="text-[14px] text-muted-foreground">
              {isEdit
                ? "Paste a new token to replace the existing one."
                : "IBM's internal LiteLLM proxy — Claude on watsonx-routed AWS."}
            </div>
          </div>
          {onCancel && (
            <IconButton
              onClick={onCancel}
              title="Cancel"
              hoverTone="neutral"
              className="self-start"
            >
              <X size={13} />
            </IconButton>
          )}
        </div>

        <a
          href={KEY_GUIDE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="group flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary hover:bg-muted"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-[14px] font-bold text-foreground">
              Need an API key?
            </span>
            <span className="text-[14px] text-muted-foreground">
              Follow the guide and generate your LiteLLM token
            </span>
          </div>
          <Launch
            size={16}
            className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-primary"
          />
        </a>

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
      </form>
    </Card>
  );
}
