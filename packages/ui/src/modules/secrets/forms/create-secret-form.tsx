import { zodResolver } from "@hookform/resolvers/zod";
import { QUERY_PARAM_RE } from "api-server-api";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import {
  allEnvMappingsValid,
  EnvMappingsEditor,
  sanitizeEnvMappings,
} from "../../../components/env-mappings-editor.js";
import { FormError } from "../../../components/form-error.js";
import { FormField } from "../../../components/form-field.js";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "../../../components/modal.js";
import { DEFAULT_INJECTION_CONFIG } from "../../../types.js";
import { useCreateSecret } from "../api/mutations.js";
import { validateEnvMappingsSize } from "../utils/env-mappings-size.js";

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
  queryParamName: z
    .string()
    .trim()
    .refine(
      (v) => v.length === 0 || QUERY_PARAM_RE.test(v),
      "Use only A-Z a-z 0-9 . _ ~ -",
    ),
  envMappings: z
    .array(envMappingSchema)
    .refine(
      allEnvMappingsValid,
      "All mappings need an env name and a placeholder",
    ),
});

type CreateSecretValues = z.infer<typeof createSecretSchema>;

const INPUT_CLASS =
  "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)]";
const MONO_INPUT_CLASS = `${INPUT_CLASS} font-mono`;

interface Props {
  onCancel: () => void;
  onCreated: () => void;
}

export function CreateSecretForm({ onCancel, onCreated }: Props) {
  const createSecret = useCreateSecret();
  const saving = createSecret.isPending;

  const { register, handleSubmit, control, formState, setError, clearErrors } =
    useForm<CreateSecretValues>({
      resolver: zodResolver(createSecretSchema),
      mode: "onChange",
      defaultValues: {
        name: "",
        value: "",
        hostPattern: "",
        pathPattern: "",
        headerName: "",
        valueFormat: "",
        queryParamName: "",
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
    const queryParamName = values.queryParamName.trim();
    const mappings = sanitizeEnvMappings(values.envMappings);
    const sizeCheck = validateEnvMappingsSize(mappings);
    if (!sizeCheck.ok) {
      setError("envMappings", {
        type: "manual",
        message: `Env mappings exceed allowed size (${sizeCheck.bytes} bytes; limit ${sizeCheck.limit}). Reduce or split across secrets.`,
      });
      return;
    }
    clearErrors("envMappings");
    const hasInjectionInput =
      headerName.length > 0 ||
      valueFormat.length > 0 ||
      queryParamName.length > 0;
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
            ...(queryParamName.length > 0 && { queryParamName }),
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
        <DialogHeader>
          <h2 className="text-[20px] font-bold text-text">Add Secret</h2>
          <p className="text-[13px] text-text-secondary leading-relaxed mt-1">
            Injects a bearer token into outgoing HTTP requests whose host
            matches the pattern below.
          </p>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-5">
          <FormField
            label="Name"
            hint="A label so you can identify this secret later."
            error={errors.name?.message}
          >
            <input
              className={INPUT_CLASS}
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
                <span className="font-mono">
                  Authorization: Bearer &lt;value&gt;
                </span>
                . Stored encrypted — the agent never sees the raw value.
              </>
            }
            error={errors.value?.message}
          >
            <input
              className={INPUT_CLASS}
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
            <input
              className={MONO_INPUT_CLASS}
              placeholder="e.g. api.linear.app"
              {...register("hostPattern")}
            />
          </FormField>

          <FormField
            label="Path Pattern (optional)"
            hint="Restrict injection to URL paths matching this pattern. Leave blank to match every path on the host."
          >
            <input
              className={MONO_INPUT_CLASS}
              placeholder="e.g. /v1/*"
              {...register("pathPattern")}
            />
          </FormField>

          <FormField
            label="Header Name (optional)"
            hint={
              <>
                HTTP header the Envoy sidecar writes the secret into. Defaults
                to{" "}
                <span className="font-mono">
                  {DEFAULT_INJECTION_CONFIG.headerName}
                </span>
                .
              </>
            }
          >
            <input
              className={MONO_INPUT_CLASS}
              placeholder={DEFAULT_INJECTION_CONFIG.headerName}
              {...register("headerName")}
            />
          </FormField>

          <FormField
            label="Value Format (optional)"
            hint={
              <>
                Template for the header value. Use{" "}
                <span className="font-mono">{`{value}`}</span> as the token
                placeholder. Defaults to{" "}
                <span className="font-mono">
                  {DEFAULT_INJECTION_CONFIG.valueFormat}
                </span>
                .
              </>
            }
          >
            <input
              className={MONO_INPUT_CLASS}
              placeholder={DEFAULT_INJECTION_CONFIG.valueFormat}
              {...register("valueFormat")}
            />
          </FormField>

          <FormField
            label="URL Query Parameter (optional)"
            hint={
              <>
                For APIs that read the credential from the URL (e.g.{" "}
                <span className="font-mono">?key=&lt;value&gt;</span>). When
                set, the bare value is moved into this query parameter and the
                header is stripped before the request leaves the sidecar — so
                <span className="font-mono"> Value Format</span> doesn't apply
                here. Need <em>both</em> a header and a URL injection on the
                same endpoint? Create two Secrets with the same host pattern —
                one header-only, one with this field set.{" "}
                <strong className="text-warning">
                  Credentials in query strings are routinely logged by web
                  servers, CDNs, and load balancers — prefer header injection
                  unless the upstream API requires this.
                </strong>
              </>
            }
            error={errors.queryParamName?.message}
          >
            <input
              className={MONO_INPUT_CLASS}
              placeholder="e.g. key"
              {...register("queryParamName")}
            />
          </FormField>

          <div className="flex flex-col gap-2">
            <span className="text-[11px] font-bold text-text-secondary uppercase tracking-[0.03em]">
              Pod Env Vars (optional)
            </span>
            <p className="text-[11px] text-text-muted">
              Inject env vars into every agent instance granted this secret. The
              placeholder (typically{" "}
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
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
            disabled={!canSave}
          >
            {saving ? "..." : "Add Secret"}
          </button>
        </DialogFooter>
      </form>
    </Modal>
  );
}
