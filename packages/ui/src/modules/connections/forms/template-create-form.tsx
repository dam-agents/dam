import {
  type ConnectionCreateInput,
  connectionNameSchema,
  type ConnectionTemplateInput,
  type ConnectionTemplateView,
} from "api-server-api";
import { useMemo, useState } from "react";

import { api } from "../../../api.js";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "../../../components/modal.js";
import { useCreateConnection } from "../api/mutations.js";

const INPUT_CLASS =
  "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

export function TemplateCreateForm({
  template,
  onCreated,
  onCancel,
}: {
  template: ConnectionTemplateView;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const create = useCreateConnection();

  // Suggest a slug from the template name (e.g. "GitHub" → "github").
  // User can override; if they create a second connection from the same
  // template they'll hit the unique constraint and get a CONFLICT error
  // pointing them at the collision.
  const [name, setName] = useState(() => slugifyTemplateName(template.name));
  const [fields, setFields] = useState<Record<string, string>>({});
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);

  const needsOAuth = template.authKind === "oauth";
  const pending = create.isPending || authorizing;

  const inputsByName = useMemo(() => {
    const map = new Map<string, ConnectionTemplateInput>();
    for (const i of template.inputs) map.set(i.name, i);
    return map;
  }, [template.inputs]);

  const f = (k: string): string => fields[k] ?? "";
  const setF = (k: string, v: string) =>
    setFields((prev) => ({ ...prev, [k]: v }));
  const isOverriding = (k: string): boolean => overrides[k] === true;

  const submittedValue = (k: string): string | undefined => {
    const input = inputsByName.get(k);
    if (!input) return undefined;
    if (input.state === "overridable" && !isOverriding(k)) return undefined;
    const v = f(k).trim();
    return v.length > 0 ? v : undefined;
  };

  const buildPayload = (): ConnectionCreateInput | { error: string } => {
    const trimmed = name.trim();
    const nameError = validateConnectionName(trimmed);
    if (nameError) return { error: nameError };
    const common = {
      templateId: template.id,
      name: trimmed,
    };
    switch (template.authKind) {
      case "oauth": {
        return {
          ...common,
          authKind: "oauth",
          ...(submittedValue("url") ? { url: submittedValue("url")! } : {}),
          ...(submittedValue("host") ? { host: submittedValue("host")! } : {}),
          ...(submittedValue("clientId")
            ? { clientId: submittedValue("clientId")! }
            : {}),
          ...(submittedValue("clientSecret")
            ? { clientSecret: submittedValue("clientSecret")! }
            : {}),
          ...(submittedValue("appSlug")
            ? { appSlug: submittedValue("appSlug")! }
            : {}),
        };
      }
      case "header": {
        const value = submittedValue("value");
        if (!value) return { error: "Secret value is required" };
        return {
          ...common,
          authKind: "header",
          ...(submittedValue("host") ? { host: submittedValue("host")! } : {}),
          ...(submittedValue("headerName")
            ? { headerName: submittedValue("headerName")! }
            : {}),
          ...(submittedValue("valueFormat")
            ? { valueFormat: submittedValue("valueFormat")! }
            : {}),
          value,
        };
      }
      case "none":
        return {
          ...common,
          authKind: "none",
          ...(submittedValue("url") ? { url: submittedValue("url")! } : {}),
        };
    }
  };

  const submit = async () => {
    setError(null);
    const payload = buildPayload();
    if ("error" in payload) {
      setError(payload.error);
      return;
    }
    if (needsOAuth) {
      setAuthorizing(true);
      try {
        const result = await api.connections.create.mutate(payload);
        const r = await api.connections.startOAuth.mutate({
          connectionId: result.id,
        });
        sessionStorage.setItem("platform-return-view", "connections");
        window.location.href = r.authUrl;
      } catch (err) {
        setAuthorizing(false);
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    try {
      const result = await create.mutateAsync(payload);
      onCreated(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const requiredOrOptional = template.inputs.filter(
    (i) => i.state === "required" || i.state === "optional",
  );
  const overridable = template.inputs.filter((i) => i.state === "overridable");

  return (
    <Modal widthClass="w-[480px]">
      <DialogHeader>
        <h2 className="text-[20px] font-bold text-text">Add {template.name}</h2>
        {template.description && (
          <p className="text-[13px] text-text-secondary mt-1">
            {template.description}
          </p>
        )}
      </DialogHeader>
      <DialogBody>
        <div className="flex flex-col gap-4">
          <LabeledInput
            label="Name"
            placeholder="my-connection"
            value={name}
            onChange={setName}
            help="Lowercase letters, digits, and single hyphens (e.g. my-mcp-server). Doubles as the MCP slug."
          />

          {requiredOrOptional.map((input) => (
            <LabeledInput
              key={input.name}
              label={
                labelFor(input.name) +
                (input.state === "optional" ? " (optional)" : "")
              }
              placeholder={placeholderFor(input.name)}
              type={input.secret ? "password" : "text"}
              value={f(input.name)}
              onChange={(v) => setF(input.name, v)}
            />
          ))}

          {overridable.length > 0 && (
            <OverridableSection
              inputs={overridable}
              fields={fields}
              overrides={overrides}
              setF={setF}
              setOverride={(k, v) =>
                setOverrides((prev) => ({ ...prev, [k]: v }))
              }
            />
          )}

          {requiredOrOptional.length === 0 && overridable.length === 0 && (
            <p className="text-[12px] text-text-muted">
              No additional inputs — preconfigured.
            </p>
          )}

          {error && (
            <p className="text-[12px] text-danger leading-relaxed">{error}</p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <button
          onClick={onCancel}
          disabled={pending}
          className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={pending}
          className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
        >
          {authorizing
            ? "Redirecting…"
            : pending
              ? "…"
              : needsOAuth
                ? "Create + Authorize"
                : "Create"}
        </button>
      </DialogFooter>
    </Modal>
  );
}

function OverridableSection({
  inputs,
  fields,
  overrides,
  setF,
  setOverride,
}: {
  inputs: ConnectionTemplateInput[];
  fields: Record<string, string>;
  overrides: Record<string, boolean>;
  setF: (k: string, v: string) => void;
  setOverride: (k: string, v: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border-2 border-dashed border-border-light p-3">
      <button
        type="button"
        className="text-[12px] font-semibold text-text-secondary hover:text-text"
        onClick={() => setExpanded((v) => !v)}
      >
        {expanded ? "▼" : "▶"} Customize defaults ({inputs.length})
      </button>
      <p className="text-[11px] text-text-muted mt-1">
        These values are pre-configured by your administrator. Leave as-is to
        use the defaults.
      </p>
      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          {inputs.map((input) => {
            const overriding = overrides[input.name] === true;
            return (
              <div key={input.name}>
                <label className="flex items-center gap-2 mb-1">
                  <input
                    type="checkbox"
                    checked={overriding}
                    onChange={(e) => setOverride(input.name, e.target.checked)}
                  />
                  <span className="text-[12px] font-semibold text-text-secondary">
                    Override {labelFor(input.name).toLowerCase()}
                  </span>
                </label>
                {!overriding && input.presetValue && (
                  <p className="text-[11px] font-mono text-text-muted pl-6">
                    Preset: {input.presetValue}
                  </p>
                )}
                {!overriding && !input.presetValue && input.secret && (
                  <p className="text-[11px] text-text-muted pl-6">
                    Preset value hidden.
                  </p>
                )}
                {overriding && (
                  <input
                    className={INPUT_CLASS}
                    type={input.secret ? "password" : "text"}
                    placeholder={placeholderFor(input.name)}
                    value={fields[input.name] ?? ""}
                    onChange={(e) => setF(input.name, e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LabeledInput({
  label,
  placeholder,
  type,
  value,
  onChange,
  help,
}: {
  label: string;
  placeholder?: string;
  type?: "text" | "password";
  value: string;
  onChange: (v: string) => void;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-text-secondary block mb-1">
        {label}
      </span>
      <input
        className={INPUT_CLASS}
        type={type ?? "text"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {help && (
        <span className="text-[11px] text-text-muted block mt-1">{help}</span>
      )}
    </label>
  );
}

/** Runs the same Zod schema the server uses, so the form surfaces the
 *  same error string the API would return — no drift to keep in sync. */
function validateConnectionName(name: string): string | null {
  const result = connectionNameSchema.safeParse(name);
  return result.success
    ? null
    : (result.error.issues[0]?.message ?? "Invalid name");
}

/** Turn the template's display name into a connection-name suggestion
 *  that satisfies `connectionNameSchema` ("GitHub" → "github",
 *  "GitHub Enterprise" → "github-enterprise"). Returns empty string if
 *  the template name has nothing usable — the user-facing required
 *  validation will then prompt for a name. */
function slugifyTemplateName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

const FIELD_LABELS: Record<string, string> = {
  url: "URL",
  host: "Host",
  headerName: "Header name",
  valueFormat: "Value format",
  value: "Secret value",
  clientId: "Client ID",
  clientSecret: "Client secret",
  appSlug: "GitHub App slug",
};

const FIELD_PLACEHOLDERS: Record<string, string> = {
  url: "https://example.com",
  host: "api.example.com",
  headerName: "X-API-Key",
  valueFormat: "{value}",
  value: "•••••",
  clientId: "Iv1.…",
  clientSecret: "•••••",
  appSlug: "my-platform-app",
};

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

function placeholderFor(key: string): string | undefined {
  return FIELD_PLACEHOLDERS[key];
}
