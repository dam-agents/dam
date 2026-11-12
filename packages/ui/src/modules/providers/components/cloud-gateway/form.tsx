import { zodResolver } from "@hookform/resolvers/zod";
import { parseCloudGatewayEndpoint } from "api-server-api";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";

import { PROVIDERS } from "../../../../types.js";
import {
  ProviderFormShell,
  ProviderSecretRow,
  requiredSecretSchema,
  stripWhitespace,
} from "../provider-form-shell.js";

const DISPLAY_NAME = PROVIDERS["curve-bender-cloud-gateway"].displayName;
const ENDPOINT_EXAMPLE =
  "https://us-east.rhai.ibm.com/v1/projects/<project-id>/inference";

const cloudGatewaySchema = z.object({
  value: requiredSecretSchema,
  endpoint: z.string().refine((v) => parseCloudGatewayEndpoint(v) !== null, {
    message: `Your project's endpoint, ${ENDPOINT_EXAMPLE}`,
  }),
});

const rotationSchema = cloudGatewaySchema.extend({ endpoint: z.string() });

type FormValues = z.infer<typeof cloudGatewaySchema>;

export function CloudGatewayForm({
  variant,
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  onSave: (input: { value: string; endpoint: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const isEdit = variant === "edit";
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(isEdit ? rotationSchema : cloudGatewaySchema),
    mode: "onChange",
    defaultValues: { value: "", endpoint: "" },
  });
  const { errors, isSubmitting, isValid } = formState;
  const submitDisabled = isSubmitting || !isValid;

  const onSubmit = handleSubmit(async (values) => {
    await onSave({
      value: stripWhitespace(values.value),
      endpoint: parseCloudGatewayEndpoint(values.endpoint)?.url ?? "",
    });
  });

  return (
    <ProviderFormShell
      provider="curve-bender-cloud-gateway"
      title={DISPLAY_NAME}
      description={
        isEdit
          ? "Paste a new IBM Cloud Gateway key to replace the existing one. To use another project endpoint, disconnect this provider and connect it again."
          : "CurveBender's models through your team's IBM Cloud Gateway project. Paste your gateway key and your project's endpoint; the platform holds the key and the agent never sees it. Pi, Bob, Copilot and Hermes run on it."
      }
      onSubmit={onSubmit}
      onCancel={onCancel}
      closeDisabled={isSubmitting}
    >
      <ProviderSecretRow
        register={register("value")}
        placeholder="IBM Cloud Gateway key"
        ariaLabel="IBM Cloud Gateway key"
        isEdit={isEdit}
        isSubmitting={isSubmitting}
        submitDisabled={submitDisabled}
      />

      {!isEdit && (
        <FormField
          label="Project endpoint"
          hint="The OpenAI-compatible endpoint of your gateway project, in any region."
          error={errors.endpoint?.message}
        >
          <Input
            type="url"
            autoComplete="off"
            aria-label="Project endpoint"
            placeholder={ENDPOINT_EXAMPLE}
            className="font-mono text-sm"
            {...register("endpoint")}
          />
        </FormField>
      )}
    </ProviderFormShell>
  );
}
