import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  allEnvMappingsValid,
  EnvMappingsEditor,
  sanitizeEnvMappings,
} from "../../../components/env-mappings-editor.js";
import { FormError } from "../../../components/form-error.js";
import { FormField } from "../../../components/form-field.js";
import { Modal } from "../../../components/modal.js";
import {
  DEFAULT_INJECTION_CONFIG,
  type EnvMapping,
  type InjectionConfig,
  type SecretView,
} from "../../../types.js";
import { useUpdateSecret } from "../api/mutations.js";

const envMappingSchema = z.object({
  envName: z.string(),
  placeholder: z.string(),
});

const baseShape = {
  name: z.string().trim().min(1, "Required"),
  // The token (`value`) is NOT round-tripped from the api-server — it lives
  // only inside the SDS file inside the K8s Secret. The field stays blank on
  // open and is only sent on save when the user types into it.
  value: z.string(),
  hostPattern: z.string().trim(),
  pathPattern: z.string().trim(),
  headerName: z.string().trim(),
  valueFormat: z.string().trim(),
  envMappings: z
    .array(envMappingSchema)
    .refine(allEnvMappingsValid, "All mappings need an env name and a placeholder"),
};

const anthropicSchema = z.object(baseShape);

// Generic secrets additionally require a non-empty host pattern. Header name,
// path pattern, and value format stay optional — matches the create form.
const genericSchema = z.object({
  ...baseShape,
  hostPattern: z.string().trim().min(1, "Required"),
});

type EditSecretValues = z.infer<typeof anthropicSchema>;

interface UpdateSecretPatch {
  id: string;
  name?: string;
  value?: string;
  hostPattern?: string;
  pathPattern?: string | null;
  injectionConfig?: InjectionConfig | null;
  envMappings?: EnvMapping[];
}

interface Props {
  secret: SecretView;
  onClose: () => void;
}

export function EditSecretDialog({ secret, onClose }: Props) {
  const isGeneric = secret.type !== "anthropic";
  const updateSecret = useUpdateSecret();
  const saving = updateSecret.isPending;

  const { register, handleSubmit, control, formState, setError } = useForm<EditSecretValues>({
    resolver: zodResolver(isGeneric ? genericSchema : anthropicSchema),
    mode: "onChange",
    defaultValues: {
      name: secret.name,
      value: "",
      hostPattern: secret.hostPattern,
      pathPattern: secret.pathPattern ?? "",
      headerName: secret.injectionConfig?.headerName ?? "",
      valueFormat: secret.injectionConfig?.valueFormat ?? "",
      envMappings: secret.envMappings ?? [],
    },
  });
  const { errors, isDirty, dirtyFields } = formState;
  // Validity is enforced by handleSubmit — clicking an invalid form populates
  // field errors instead of silently no-op'ing a disabled button.
  const canSave = isDirty && !saving;

  const onSubmit = handleSubmit((values) => {
    const patch: UpdateSecretPatch = { id: secret.id };
    if (dirtyFields.name) patch.name = values.name.trim();
    if (dirtyFields.value && values.value.length > 0) patch.value = values.value;
    if (isGeneric) {
      if (dirtyFields.hostPattern) patch.hostPattern = values.hostPattern.trim();
      if (dirtyFields.pathPattern) {
        const trimmed = values.pathPattern.trim();
        patch.pathPattern = trimmed === "" ? null : trimmed;
      }
      if (dirtyFields.headerName || dirtyFields.valueFormat) {
        if (patch.value === undefined) {
          // The api-server rejects this combination because the SDS file is
          // pre-baked with the previous format and would drift. Surface it
          // inline instead of round-tripping for the error.
          setError("value", {
            type: "manual",
            message: "Re-enter the token when changing the header or value format.",
          });
          return;
        }
        const header = values.headerName.trim() || DEFAULT_INJECTION_CONFIG.headerName;
        const format = values.valueFormat.trim();
        patch.injectionConfig = {
          headerName: header,
          ...(format.length > 0 && { valueFormat: format }),
        };
      }
    }
    if (dirtyFields.envMappings) {
      patch.envMappings = sanitizeEnvMappings(values.envMappings);
    }
    updateSecret.mutate(patch, { onSuccess: onClose });
  });

  return (
    <Modal widthClass="w-[540px]">
      <form onSubmit={onSubmit} className="contents">
        <div className="px-7 pt-7 pb-4 border-b border-border">
          <h2 className="text-[20px] font-bold text-foreground">Edit Secret</h2>
          <p className="text-[12px] text-muted-foreground mt-1 font-mono">
            {secret.hostPattern}
            {secret.pathPattern && (
              <span className="text-foreground/80">{secret.pathPattern}</span>
            )}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-5">
          <FormField label="Name" error={errors.name?.message}>
            <Input autoFocus {...register("name")} />
          </FormField>

          <FormField
            label="Token"
            hint="Leave blank to keep the current token. Type a new value to rotate it."
            error={errors.value?.message}
          >
            <Input
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              disabled={saving}
              {...register("value")}
            />
          </FormField>

          {isGeneric && (
            <FormField
              label="Host Pattern"
              hint="Hostname the Envoy sidecar matches against outbound requests. Required."
              error={errors.hostPattern?.message}
            >
              <Input
                className="font-mono"
                placeholder="e.g. api.example.com"
                disabled={saving}
                {...register("hostPattern")}
              />
            </FormField>
          )}

          {isGeneric && (
            <FormField
              label="Path Pattern"
              hint="Restrict injection to URL paths matching this pattern. Leave blank to match every path on the host."
            >
              <Input
                className="font-mono"
                placeholder="e.g. /v1/*"
                disabled={saving}
                {...register("pathPattern")}
              />
            </FormField>
          )}

          {isGeneric && (
            <FormField
              label="Header Name"
              hint="HTTP header the Envoy sidecar writes the secret into."
              error={errors.headerName?.message}
            >
              <Input
                className="font-mono"
                placeholder={DEFAULT_INJECTION_CONFIG.headerName}
                disabled={saving}
                {...register("headerName")}
              />
            </FormField>
          )}

          {isGeneric && (
            <FormField
              label="Value Format"
              hint={
                <>
                  Template for the header value. Use{" "}
                  <span className="font-mono">{`{value}`}</span> as the token
                  placeholder.
                </>
              }
            >
              <Input
                className="font-mono"
                placeholder={DEFAULT_INJECTION_CONFIG.valueFormat}
                disabled={saving}
                {...register("valueFormat")}
              />
            </FormField>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold text-foreground/80 uppercase tracking-[0.03em]">
              Pod Env Vars
            </span>
            <p className="text-[11px] text-muted-foreground">
              Applied to every instance granted this connector on next pod
              restart.
            </p>
            <Controller
              control={control}
              name="envMappings"
              render={({ field }) => (
                <EnvMappingsEditor
                  value={field.value}
                  onChange={field.onChange}
                  disabled={saving}
                />
              )}
            />
            <FormError message={errors.envMappings?.message} />
          </div>
        </div>

        <div className="px-7 py-4 border-t border-border flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSave}
          >
            {saving ? "..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
