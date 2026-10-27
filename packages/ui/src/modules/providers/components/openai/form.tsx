import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { PROVIDERS } from "../../../../types.js";
import {
  ProviderFormShell,
  ProviderSecretRow,
  requiredSecretSchema,
  stripWhitespace,
} from "../provider-form-shell.js";

const OPENAI_DISPLAY_NAME = PROVIDERS.openai.displayName;
const OPENAI_KEY_PAGE_URL = "https://platform.openai.com/api-keys";

const openaiCredentialSchema = z.object({ value: requiredSecretSchema });

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
      keyPage={{
        href: OPENAI_KEY_PAGE_URL,
        hint: "Create a secret key in the OpenAI dashboard",
      }}
      onSubmit={onSubmit}
      onCancel={onCancel}
      closeDisabled={isSubmitting}
    >
      <ProviderSecretRow
        register={register("value")}
        placeholder="sk-…"
        ariaLabel="OpenAI API key"
        isEdit={isEdit}
        isSubmitting={isSubmitting}
        submitDisabled={submitDisabled}
        value={value}
        error={errors.value}
      />
    </ProviderFormShell>
  );
}
