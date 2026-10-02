import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  BEDROCK_REGION_PATTERN,
  type BedrockPins,
  PROVIDERS,
} from "../../../../types.js";
import { ProviderFormShell, stripWhitespace } from "../provider-form-shell.js";

const BEDROCK_DISPLAY_NAME = PROVIDERS.bedrock.displayName;
const DEFAULT_REGION = "us-east-1";
const REGION_RE = new RegExp(`^(?:${BEDROCK_REGION_PATTERN})$`);

const bedrockCredentialSchema = z.object({
  value: z
    .string()
    .refine((v) => stripWhitespace(v).length > 0, { message: "Required" }),
  region: z
    .string()
    .trim()
    .regex(REGION_RE, { message: "An AWS region, e.g. us-east-1" }),
  model: z.string(),
});

type FormValues = z.infer<typeof bedrockCredentialSchema>;

export function BedrockForm({
  variant,
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  onSave: (input: { value: string; pins: BedrockPins }) => Promise<void>;
  onCancel?: () => void;
}) {
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(bedrockCredentialSchema),
    mode: "onChange",
    defaultValues: { value: "", region: DEFAULT_REGION, model: "" },
  });
  const { errors, isSubmitting, isValid } = formState;

  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;

  const onSubmit = handleSubmit(async (values) => {
    await onSave({
      value: stripWhitespace(values.value),
      pins: {
        region: values.region.trim(),
        model: values.model.trim() || undefined,
      },
    });
  });

  return (
    <ProviderFormShell
      provider="bedrock"
      title={BEDROCK_DISPLAY_NAME}
      description={
        isEdit
          ? "Paste a new Bedrock API key to replace the existing one."
          : "Models your organization hosts in AWS Bedrock. Paste a Bedrock API key; the platform holds it and the agent never sees it."
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
          placeholder="Bedrock API key"
          aria-label="Bedrock API key"
          {...register("value")}
        />
        <Button type="submit" disabled={submitDisabled} className="shrink-0">
          {isSubmitting ? "..." : isEdit ? "Replace" : "Save"}
        </Button>
      </div>

      {!isEdit && (
        <div className="grid grid-cols-1 gap-3">
          <FormField
            label="Region"
            hint="The AWS region the key's models are served from."
            error={errors.region?.message}
          >
            <Input
              type="text"
              autoComplete="off"
              placeholder={DEFAULT_REGION}
              className="font-mono text-sm"
              {...register("region")}
            />
          </FormField>
          <FormField
            label="Model"
            hint="Optional. Leave empty and agents start on one of the region's inference profiles, and offer the rest to choose from. A model set here must be an inference-profile ID such as eu.anthropic.claude-sonnet-4-6."
          >
            <Input
              type="text"
              autoComplete="off"
              placeholder="Pick one of the region's inference profiles"
              className="font-mono text-sm"
              {...register("model")}
            />
          </FormField>
        </div>
      )}
    </ProviderFormShell>
  );
}
