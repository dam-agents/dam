import { Launch } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { externalLinkProps } from "@/lib/external-link";

import {
  BEDROCK_REGION_PATTERN,
  type BedrockPins,
  PROVIDERS,
} from "../../../../types.js";
import { ProviderFormShell, stripWhitespace } from "../provider-form-shell.js";

const BEDROCK_DISPLAY_NAME = PROVIDERS.bedrock.displayName;
const DEFAULT_REGION = "us-east-1";
const BEDROCK_CONSOLE_URL = "https://console.aws.amazon.com/bedrock/";
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
      {!isEdit && (
        <a
          href={BEDROCK_CONSOLE_URL}
          {...externalLinkProps}
          className="group flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
        >
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-foreground">
              New to AWS Bedrock?
            </span>
            <ol className="list-decimal pl-4 text-sm text-muted-foreground">
              <li>
                In the Bedrock console's Model catalog, open an Anthropic model
                and submit the use case form. Once per AWS account.
              </li>
              <li>
                Under API keys, create a long-term key. Short-term keys expire
                within hours.
              </li>
            </ol>
          </div>
          <Launch
            size={16}
            className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-primary"
          />
        </a>
      )}

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
            hint="Optional. Leave empty and agents start on one of the region's inference profiles, and offer the rest to choose from. A model set here must be an inference-profile ID such as us.anthropic.claude-sonnet-4-6."
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
