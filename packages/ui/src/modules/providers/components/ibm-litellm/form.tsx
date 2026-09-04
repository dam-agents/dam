import { Launch } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KEY_GUIDE_URL } from "@/constants.js";
import { externalLinkProps } from "@/lib/external-link";

import { IBM_LITELLM_BOB_MODEL } from "../../../../types.js";
import { ProviderFormShell } from "../provider-form-shell.js";
import { MODES, stripWhitespace } from "./modes.js";

const ibmLitellmCredentialSchema = z
  .object({ value: z.string(), bobModel: z.string() })
  .superRefine((data, ctx) => {
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
  onSave: (input: { value: string; bobModel: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(ibmLitellmCredentialSchema),
    mode: "onChange",
    defaultValues: { value: "", bobModel: "" },
  });
  const { isSubmitting, isValid } = formState;

  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;

  const onSubmit = handleSubmit(async (values) => {
    await onSave({
      value: stripWhitespace(values.value),
      bobModel: values.bobModel.trim(),
    });
  });

  return (
    <ProviderFormShell
      provider="ibm-litellm"
      title="IBM LiteLLM ETE Proxy"
      description={
        isEdit
          ? "Paste a new token to replace the existing one."
          : "IBM's internal LiteLLM proxy — Claude on watsonx-routed AWS."
      }
      onSubmit={onSubmit}
      onCancel={onCancel}
    >
      <a
        href={KEY_GUIDE_URL}
        {...externalLinkProps}
        className="group flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
      >
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-bold text-foreground">
            Need an API key?
          </span>
          <span className="text-sm text-muted-foreground">
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

      {!isEdit && (
        <FormField
          label="Bob model"
          hint={`Model Bob asks this proxy for. Empty → ${IBM_LITELLM_BOB_MODEL}.`}
        >
          <Input
            type="text"
            autoComplete="off"
            data-1p-ignore
            data-lpignore="true"
            placeholder={IBM_LITELLM_BOB_MODEL}
            className="font-mono text-sm"
            {...register("bobModel")}
          />
        </FormField>
      )}
    </ProviderFormShell>
  );
}
