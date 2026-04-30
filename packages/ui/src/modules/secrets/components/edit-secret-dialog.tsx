import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

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

const INPUT_CLASS =
  "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]";
const MONO_INPUT_CLASS = `${INPUT_CLASS} font-mono`;

interface UpdateSecretPatch {
  id: string;
  name?: string;
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

  const { register, handleSubmit, control, formState } = useForm<EditSecretValues>({
    resolver: zodResolver(isGeneric ? genericSchema : anthropicSchema),
    mode: "onChange",
    defaultValues: {
      name: secret.name,
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
    if (isGeneric) {
      if (dirtyFields.hostPattern) patch.hostPattern = values.hostPattern.trim();
      if (dirtyFields.pathPattern) {
        const trimmed = values.pathPattern.trim();
        patch.pathPattern = trimmed === "" ? null : trimmed;
      }
      if (dirtyFields.headerName || dirtyFields.valueFormat) {
        const header = values.headerName.trim();
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
        <div className="px-7 pt-7 pb-4 border-b-2 border-border-light">
          <h2 className="text-[20px] font-bold text-text">Edit Secret</h2>
          <p className="text-[12px] text-text-muted mt-1 font-mono">
            {secret.hostPattern}
            {secret.pathPattern && (
              <span className="text-text-secondary">{secret.pathPattern}</span>
            )}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-5">
          <FormField label="Name" error={errors.name?.message}>
            <input className={INPUT_CLASS} autoFocus {...register("name")} />
          </FormField>

          {isGeneric && (
            <FormField
              label="Host Pattern"
              hint="Hostname OneCLI matches against outbound requests. Required."
              error={errors.hostPattern?.message}
            >
              <input
                className={MONO_INPUT_CLASS}
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
              <input
                className={MONO_INPUT_CLASS}
                placeholder="e.g. /v1/*"
                disabled={saving}
                {...register("pathPattern")}
              />
            </FormField>
          )}

          {isGeneric && (
            <FormField
              label="Header Name"
              hint="HTTP header OneCLI writes the secret into."
              error={errors.headerName?.message}
            >
              <input
                className={MONO_INPUT_CLASS}
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
              <input
                className={MONO_INPUT_CLASS}
                placeholder={DEFAULT_INJECTION_CONFIG.valueFormat}
                disabled={saving}
                {...register("valueFormat")}
              />
            </FormField>
          )}

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
              Pod Env Vars
            </span>
            <p className="text-[11px] text-text-muted">
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

        <div className="px-7 py-4 border-t-2 border-border-light flex justify-end gap-3">
          <button
            type="button"
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
            disabled={!canSave}
          >
            {saving ? "..." : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
