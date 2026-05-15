import { zodResolver } from "@hookform/resolvers/zod";
import { QUERY_PARAM_RE } from "api-server-api";
import { useState } from "react";
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
import { useGrantedAgentsForSecret } from "../api/queries.js";
import { validateEnvMappingsSize } from "../utils/env-mappings-size.js";

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
  queryParamName: z
    .string()
    .trim()
    .refine(
      (v) => v.length === 0 || QUERY_PARAM_RE.test(v),
      "Use only A-Z a-z 0-9 . _ ~ -",
    ),
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
  const isGeneric = secret.type === "generic";
  const updateSecret = useUpdateSecret();
  const saving = updateSecret.isPending;
  const [pendingPatch, setPendingPatch] = useState<UpdateSecretPatch | null>(null);
  // Only fetch when there's a pending env-affecting patch to confirm —
  // skips the tRPC roundtrip for cosmetic edits and the initial render.
  const grantedAgentsQuery = useGrantedAgentsForSecret(secret.id, {
    enabled: pendingPatch !== null,
  });

  const { register, handleSubmit, control, formState, setError, clearErrors } = useForm<EditSecretValues>({
    resolver: zodResolver(isGeneric ? genericSchema : anthropicSchema),
    mode: "onChange",
    defaultValues: {
      name: secret.name,
      value: "",
      hostPattern: secret.hostPattern,
      pathPattern: secret.pathPattern ?? "",
      headerName: secret.injectionConfig?.headerName ?? "",
      valueFormat: secret.injectionConfig?.valueFormat ?? "",
      queryParamName: secret.injectionConfig?.queryParamName ?? "",
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
      if (dirtyFields.headerName || dirtyFields.valueFormat || dirtyFields.queryParamName) {
        if (patch.value === undefined) {
          // The api-server rejects this combination because the SDS file is
          // pre-baked with the previous format and would drift. Surface it
          // inline instead of round-tripping for the error.
          setError("value", {
            type: "manual",
            message: "Re-enter the token when changing the header, value format, or query parameter.",
          });
          return;
        }
        const header = values.headerName.trim() || DEFAULT_INJECTION_CONFIG.headerName;
        const format = values.valueFormat.trim();
        const queryParam = values.queryParamName.trim();
        patch.injectionConfig = {
          headerName: header,
          ...(format.length > 0 && { valueFormat: format }),
          ...(queryParam.length > 0 && { queryParamName: queryParam }),
        };
      }
    }
    if (dirtyFields.envMappings) {
      const sanitized = sanitizeEnvMappings(values.envMappings);
      const sizeCheck = validateEnvMappingsSize(sanitized);
      if (!sizeCheck.ok) {
        setError("envMappings", {
          type: "manual",
          message: `Env mappings exceed allowed size (${sizeCheck.bytes} bytes; limit ${sizeCheck.limit}). Reduce or split across secrets.`,
        });
        return;
      }
      clearErrors("envMappings");
      patch.envMappings = sanitized;
    }
    // ADR-040: envMappings is the only field that rolls the agent pod
    // (pod env is immutable). Other dirty fields are hot — apply directly.
    if (dirtyFields.envMappings) {
      setPendingPatch(patch);
      return;
    }
    updateSecret.mutate(patch, { onSuccess: onClose });
  });

  const confirmAndApply = () => {
    if (!pendingPatch) return;
    updateSecret.mutate(pendingPatch, {
      onSuccess: () => {
        setPendingPatch(null);
        onClose();
      },
    });
  };

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

          <FormField
            label="Token"
            hint="Leave blank to keep the current token. Type a new value to rotate it."
            error={errors.value?.message}
          >
            <input
              className={INPUT_CLASS}
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
              hint="HTTP header the Envoy sidecar writes the secret into."
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

          {isGeneric && (
            <FormField
              label="URL Query Parameter"
              hint={
                <>
                  For APIs that read the credential from the URL (e.g.{" "}
                  <span className="font-mono">?key=&lt;value&gt;</span>). When
                  set, the bare value is moved into this query parameter and
                  the header is stripped — <span className="font-mono">Value
                  Format</span> doesn't apply here. Need <em>both</em> a
                  header and a URL injection on the same endpoint? Create two
                  Secrets with the same host pattern.{" "}
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
                disabled={saving}
                {...register("queryParamName")}
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
      {pendingPatch && (
        <RollConfirmation
          loading={grantedAgentsQuery.isLoading}
          error={grantedAgentsQuery.isError}
          agents={grantedAgentsQuery.data ?? []}
          saving={saving}
          onCancel={() => setPendingPatch(null)}
          onConfirm={confirmAndApply}
        />
      )}
    </Modal>
  );
}

// Pod env is immutable on a running pod, so envMappings edits roll every
// granted agent (ADR-040). Show the user what they're about to disturb.
function RollConfirmation({
  loading,
  error,
  agents,
  saving,
  onCancel,
  onConfirm,
}: {
  loading: boolean;
  error: boolean;
  agents: { id: string; name: string }[];
  saving: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10 rounded-2xl">
      <div className="w-[420px] rounded-xl border-2 border-border bg-bg p-6 shadow-brutal-lg flex flex-col gap-4">
        <div>
          <h3 className="text-[16px] font-bold text-text">Restart granted agents?</h3>
          <p className="text-[13px] text-text-secondary mt-2">
            Editing env mappings on this secret rolls every agent that has it
            granted. Running sessions on those agents will be interrupted.
          </p>
        </div>
        {loading ? (
          <p className="text-[12px] text-text-muted italic">
            Looking up affected agents…
          </p>
        ) : error ? (
          // Without this branch, an isError state collapses to `agents=[]`
          // and the dialog would say "no agents granted" — letting the user
          // confirm a roll against an empty list produced by an API failure.
          <p className="text-[12px] text-danger">
            Couldn't load the list of affected agents. Cancel and try again.
          </p>
        ) : agents.length === 0 ? (
          <p className="text-[12px] text-text-muted">
            No agents currently have this secret granted.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold text-text-muted uppercase tracking-[0.05em]">
              Affected ({agents.length})
            </span>
            <ul className="list-disc pl-5 text-[12px] text-text-secondary max-h-32 overflow-y-auto">
              {agents.map((a) => (
                <li key={a.id}>{a.name}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
            onClick={onConfirm}
            disabled={saving || loading || error}
          >
            {saving ? "Saving…" : "Restart and save"}
          </button>
        </div>
      </div>
    </div>
  );
}
