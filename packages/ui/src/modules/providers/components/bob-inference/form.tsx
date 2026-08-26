import { Launch } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { externalLinkProps } from "@/lib/external-link";

import { ProviderFormShell } from "../provider-form-shell.js";
import { MODES, stripWhitespace } from "./modes.js";

const bobInferenceCredentialSchema = z
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

type FormValues = z.infer<typeof bobInferenceCredentialSchema>;

export function BobInferenceForm({
  variant,
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  onSave: (input: { value: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(bobInferenceCredentialSchema),
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
    <ProviderFormShell
      provider="bob-inference"
      title="Bob Inference"
      description={
        <>
          {isEdit
            ? "Paste a new token to replace the existing one."
            : "Claude models through Bob, for Claude Code. Paste a Bob API key of type Inference to get started."}{" "}
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
    </ProviderFormShell>
  );
}
