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
import { DEFAULT_INJECTION_CONFIG } from "../../../types.js";
import { useCreateSecret } from "../api/mutations.js";

const envMappingSchema = z.object({
  envName: z.string(),
  placeholder: z.string(),
});

const createSecretSchema = z.object({
  name: z.string().trim().min(1, "Required"),
  value: z.string().trim().min(1, "Required"),
  hostPattern: z.string().trim().min(1, "Required"),
  pathPattern: z.string().trim(),
  headerName: z.string().trim(),
  valueFormat: z.string().trim(),
  envMappings: z
    .array(envMappingSchema)
    .refine(allEnvMappingsValid, "All mappings need an env name and a placeholder"),
});

type CreateSecretValues = z.infer<typeof createSecretSchema>;

interface Props {
  onCancel: () => void;
  onCreated: () => void;
}

export function CreateSecretForm({ onCancel, onCreated }: Props) {
  const createSecret = useCreateSecret();
  const saving = createSecret.isPending;

  const { register, handleSubmit, control, formState } = useForm<CreateSecretValues>({
    resolver: zodResolver(createSecretSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      value: "",
      hostPattern: "",
      pathPattern: "",
      headerName: "",
      valueFormat: "",
      envMappings: [],
    },
  });
  const { errors, isDirty } = formState;
  // Validity is enforced by handleSubmit — clicking an invalid form populates
  // field errors instead of silently no-op'ing a disabled button.
  const canSave = isDirty && !saving;

  const onSubmit = handleSubmit((values) => {
    const pathPattern = values.pathPattern.trim();
    const headerName = values.headerName.trim();
    const valueFormat = values.valueFormat.trim();
    const mappings = sanitizeEnvMappings(values.envMappings);
    // Send injectionConfig if EITHER field was filled. When only the value
    // format is customised (e.g. `Basic {value}`), default the header to
    // `Authorization` so the user's chosen format isn't silently discarded.
    const hasInjectionInput = headerName.length > 0 || valueFormat.length > 0;
    createSecret.mutate(
      {
        type: "generic",
        name: values.name.trim(),
        value: values.value.trim(),
        hostPattern: values.hostPattern.trim(),
        ...(pathPattern.length > 0 && { pathPattern }),
        ...(hasInjectionInput && {
          injectionConfig: {
            headerName: headerName || DEFAULT_INJECTION_CONFIG.headerName,
            ...(valueFormat.length > 0 && { valueFormat }),
          },
        }),
        ...(mappings.length > 0 && { envMappings: mappings }),
      },
      { onSuccess: onCreated },
    );
  });

  return (
    <Modal widthClass="w-[480px]">
      <form onSubmit={onSubmit} className="contents">
        <div className="px-7 pt-7 pb-4 border-b border-border">
          <h2 className="text-[20px] font-bold text-foreground">Add Secret</h2>
          <p className="text-[13px] text-foreground/80 leading-relaxed mt-1">
            Injects a bearer token into outgoing HTTP requests whose host
            matches the pattern below.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-7 py-5 flex flex-col gap-5">
          <FormField
            label="Name"
            hint="A label so you can identify this secret later."
            error={errors.name?.message}
          >
            <Input
              placeholder="e.g. Linear Token"
              autoFocus
              {...register("name")}
            />
          </FormField>

          <FormField
            label="Token"
            hint={
              <>
                Injected as{" "}
                <span className="font-mono">Authorization: Bearer &lt;value&gt;</span>. Stored
                encrypted — the agent never sees the raw value.
              </>
            }
            error={errors.value?.message}
          >
            <Input
              type="password"
              placeholder="The secret value to inject"
              {...register("value")}
            />
          </FormField>

          <FormField
            label="Host Pattern"
            hint={
              <>
                Hostname the token applies to. Supports wildcards (e.g.{" "}
                <span className="font-mono">*.example.com</span>).
              </>
            }
            error={errors.hostPattern?.message}
          >
            <Input
              className="font-mono"
              placeholder="e.g. api.linear.app"
              {...register("hostPattern")}
            />
          </FormField>

          <FormField
            label="Path Pattern (optional)"
            hint="Restrict injection to URL paths matching this pattern. Leave blank to match every path on the host."
          >
            <Input
              className="font-mono"
              placeholder="e.g. /v1/*"
              {...register("pathPattern")}
            />
          </FormField>

          <FormField
            label="Header Name (optional)"
            hint={
              <>
                HTTP header the Envoy sidecar writes the secret into. Defaults to{" "}
                <span className="font-mono">{DEFAULT_INJECTION_CONFIG.headerName}</span>.
              </>
            }
          >
            <Input
              className="font-mono"
              placeholder={DEFAULT_INJECTION_CONFIG.headerName}
              {...register("headerName")}
            />
          </FormField>

          <FormField
            label="Value Format (optional)"
            hint={
              <>
                Template for the header value. Use{" "}
                <span className="font-mono">{`{value}`}</span> as the token placeholder. Defaults
                to <span className="font-mono">{DEFAULT_INJECTION_CONFIG.valueFormat}</span>.
              </>
            }
          >
            <Input
              className="font-mono"
              placeholder={DEFAULT_INJECTION_CONFIG.valueFormat}
              {...register("valueFormat")}
            />
          </FormField>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold text-foreground/80 uppercase tracking-[0.03em]">
              Pod Env Vars (optional)
            </span>
            <p className="text-[11px] text-muted-foreground">
              Inject env vars into every agent instance granted this secret.
              The placeholder (typically{" "}
              <span className="font-mono">dummy-placeholder</span>) is swapped
              for the real value on the wire by the Envoy sidecar.
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
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!canSave}
          >
            {saving ? "..." : "Add Secret"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
