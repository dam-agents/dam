import {
  type ConnectionCreateInput,
  connectionNameSchema,
  type ConnectionTemplateInput,
  type ConnectionTemplateView,
} from "api-server-api";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { api } from "../../../api.js";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "../../../components/modal.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useCreateConnection } from "../api/mutations.js";
import { useOAuthPopup } from "../hooks/use-oauth-popup.js";

export function TemplateCreateForm({
  template,
  onCreated,
  onCancel,
  oauthReturnView,
  onOAuthRedirect,
  popupOAuth,
}: {
  template: ConnectionTemplateView;
  onCreated: (id: string) => void;
  onCancel: () => void;
  /** Full-page OAuth return path; defaults to Settings → Connections. */
  oauthReturnView?: string;
  /** Called with the new connection's id just before a full-page OAuth redirect. */
  onOAuthRedirect?: (connectionId: string) => void;
  /** Prefer a popup for OAuth (full-page redirect when blocked). */
  popupOAuth?: boolean;
}) {
  const create = useCreateConnection();

  const [name, setName] = useState(() => slugifyTemplateName(template.name));
  const [fields, setFields] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const i of template.inputs) {
      if (i.presetValue !== undefined && !i.secret)
        init[i.name] = i.presetValue;
    }
    return init;
  });
  const [overrideDefaults, setOverrideDefaults] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authorizing, setAuthorizing] = useState(false);

  const pendingIdRef = useRef<string | null>(null);
  const { open: openPopup, close: closePopup } = useOAuthPopup((result) => {
    setAuthorizing(false);
    if (result.ok && pendingIdRef.current) {
      // No page reload happened, so refresh the list ourselves.
      void queryClient.invalidateQueries({
        queryKey: trpc.connections.list.queryKey(),
      });
      onCreated(pendingIdRef.current);
    } else if (result.message) setError(result.message);
    pendingIdRef.current = null;
  });

  const needsOAuth = template.authKind === "oauth";
  const pending = create.isPending || authorizing;

  const inputsByName = useMemo(() => {
    const map = new Map<string, ConnectionTemplateInput>();
    for (const i of template.inputs) map.set(i.name, i);
    return map;
  }, [template.inputs]);

  const bringYourOwnApp =
    needsOAuth && inputsByName.get("clientId")?.state === "required";

  const extraStr = (k: string): string | undefined => {
    const v = template.extras?.[k];
    return typeof v === "string" ? v : undefined;
  };

  // Overridable client creds can come from an operator preset or be reused
  // from a sibling connection in the same credential family — the copy differs.
  const credentialsFromFamily = template.extras?.credentialsFromFamily === true;

  const f = (k: string): string => fields[k] ?? "";
  const setF = (k: string, v: string) =>
    setFields((prev) => ({ ...prev, [k]: v }));

  const submittedValue = (k: string): string | undefined => {
    const input = inputsByName.get(k);
    if (!input) return undefined;
    if (input.state === "overridable" && !overrideDefaults) return undefined;
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
        const configInputs: Record<string, string> = {};
        for (const input of template.inputs) {
          if (!input.configInput) continue;
          const v = submittedValue(input.name);
          if (v) configInputs[input.name] = v;
        }
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
          ...(submittedValue("envName")
            ? { envName: submittedValue("envName")! }
            : {}),
          ...(Object.keys(configInputs).length > 0 ? { configInputs } : {}),
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
      // Open the popup synchronously (or it gets blocked); navigate it below.
      const popup = popupOAuth ? openPopup() : null;
      if (popup) {
        setAuthorizing(true);
        try {
          const result = await api.connections.create.mutate(payload);
          pendingIdRef.current = result.id;
          const r = await api.connections.startOAuth.mutate({
            connectionId: result.id,
            popup: true,
          });
          popup.location.href = r.authUrl;
        } catch (err) {
          closePopup();
          pendingIdRef.current = null;
          setAuthorizing(false);
          setError(err instanceof Error ? err.message : String(err));
        }
        return;
      }

      // Fallback: full-page redirect (popup blocked, or not requested).
      setAuthorizing(true);
      try {
        const result = await api.connections.create.mutate(payload);
        const r = await api.connections.startOAuth.mutate({
          connectionId: result.id,
          ...(oauthReturnView ? { returnTo: oauthReturnView } : {}),
        });
        if (oauthReturnView) onOAuthRedirect?.(result.id);
        else
          sessionStorage.setItem(
            "platform-return-view",
            "/settings/connections",
          );
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
        <h2 className="text-[20px] font-bold text-foreground">
          Add {template.name}
        </h2>
        {template.description && (
          <p className="text-[13px] text-foreground/80 mt-1">
            {template.description}
          </p>
        )}
      </DialogHeader>
      <DialogBody>
        <div className="flex flex-col gap-4">
          <LabeledInput
            label="Name"
            testId="connection-field-name"
            placeholder="my-connection"
            value={name}
            onChange={setName}
            help="Lowercase letters, digits, and single hyphens (e.g. my-mcp-server). Doubles as the MCP slug."
          />

          {bringYourOwnApp && (
            <OAuthAppHint
              callbackUrl={extraStr("callbackUrl")}
              setupUrl={extraStr("setupUrl")}
            />
          )}

          {requiredOrOptional.map((input) => (
            <LabeledInput
              key={input.name}
              label={
                (input.label ?? labelFor(input.name)) +
                (input.state === "optional" ? " (optional)" : "")
              }
              testId={`connection-field-${input.name}`}
              placeholder={placeholderFor(input.name)}
              type={input.secret ? "password" : "text"}
              value={f(input.name)}
              onChange={(v) => setF(input.name, v)}
              help={input.hint}
            />
          ))}

          {overridable.length > 0 && (
            <OverridableSection
              inputs={overridable}
              fields={fields}
              overriding={overrideDefaults}
              fromFamily={credentialsFromFamily}
              setF={setF}
              setOverriding={setOverrideDefaults}
            />
          )}

          {requiredOrOptional.length === 0 && overridable.length === 0 && (
            <p className="text-[12px] text-muted-foreground">
              No additional inputs — preconfigured.
            </p>
          )}

          {error && (
            <p className="text-[12px] text-destructive leading-relaxed">
              {error}
            </p>
          )}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
        <Button
          onClick={submit}
          disabled={pending}
          data-testid="connection-create-submit"
        >
          {authorizing
            ? "Redirecting…"
            : pending
              ? "…"
              : needsOAuth
                ? "Create + Authorize"
                : "Create"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}

function OAuthAppHint({
  callbackUrl,
  setupUrl,
}: {
  callbackUrl?: string;
  setupUrl?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!callbackUrl && !setupUrl) return null;

  const copy = () => {
    if (!callbackUrl) return;
    navigator.clipboard.writeText(callbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3 flex flex-col gap-2">
      <p className="text-[12px] text-foreground/80">
        Register an OAuth app at the provider, then paste its client credentials
        below.
        {setupUrl && (
          <>
            {" "}
            <a
              href={setupUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
            >
              Create an app <ExternalLink size={11} />
            </a>
          </>
        )}
      </p>
      {callbackUrl && (
        <div>
          <span className="text-[11px] text-muted-foreground block mb-1">
            Add this exact redirect URI to your app:
          </span>
          <div className="flex items-center gap-1.5">
            <code className="text-[11px] font-mono text-foreground/90 break-all">
              {callbackUrl}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0"
              onClick={copy}
              title="Copy redirect URI"
            >
              {copied ? (
                <Check size={12} className="text-success" />
              ) : (
                <Copy size={12} />
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function OverridableSection({
  inputs,
  fields,
  overriding,
  fromFamily,
  setF,
  setOverriding,
}: {
  inputs: ConnectionTemplateInput[];
  fields: Record<string, string>;
  overriding: boolean;
  fromFamily?: boolean;
  setF: (k: string, v: string) => void;
  setOverriding: (v: boolean) => void;
}) {
  // A single toggle flips the whole overridable group: the fields only make
  // sense overridden together (your own app means all of its credentials, not
  // a mix of presets and custom values), so we don't expose them per-field.
  return (
    <div className="rounded-lg border border-dashed border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <span className="text-[12px] font-semibold text-foreground/80 block">
            Customize defaults
          </span>
          <p className="text-[11px] text-muted-foreground mt-1">
            {fromFamily
              ? "Reused from another connection you've already set up. Leave off to share the same app, or turn on to use your own."
              : "These values are pre-configured by your administrator. Leave off to use the defaults, or turn on to supply your own."}
          </p>
        </div>
        <Switch
          checked={overriding}
          onCheckedChange={setOverriding}
          testId="override-defaults-toggle"
          label="Customize defaults"
        />
      </div>
      {overriding ? (
        <div className="mt-3 flex flex-col gap-3">
          {inputs.map((input) => (
            <LabeledInput
              key={input.name}
              label={input.label ?? labelFor(input.name)}
              placeholder={placeholderFor(input.name)}
              type={input.secret ? "password" : "text"}
              value={fields[input.name] ?? ""}
              onChange={(v) => setF(input.name, v)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-1.5">
          {inputs.map((input) => (
            <PresetSummary key={input.name} input={input} />
          ))}
        </div>
      )}
    </div>
  );
}

function PresetSummary({ input }: { input: ConnectionTemplateInput }) {
  if (input.presetValue)
    return (
      <p className="text-[11px] font-mono text-muted-foreground">
        {labelFor(input.name)}: {input.presetValue}
      </p>
    );
  if (input.secret)
    return (
      <p className="text-[11px] text-muted-foreground">
        {labelFor(input.name)}: preset value hidden.
      </p>
    );
  return null;
}

function LabeledInput({
  label,
  testId,
  placeholder,
  type,
  value,
  onChange,
  help,
}: {
  label: string;
  testId?: string;
  placeholder?: string;
  type?: "text" | "password";
  value: string;
  onChange: (v: string) => void;
  help?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-semibold text-foreground/80 block mb-1">
        {label}
      </span>
      <Input
        type={type ?? "text"}
        data-testid={testId}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {help && (
        <span className="text-[11px] text-muted-foreground block mt-1">
          {help}
        </span>
      )}
    </label>
  );
}

function validateConnectionName(name: string): string | null {
  const result = connectionNameSchema.safeParse(name);
  return result.success
    ? null
    : (result.error.issues[0]?.message ?? "Invalid name");
}

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
  envName: "Environment variable",
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
  envName: "MY_API_KEY",
};

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

function placeholderFor(key: string): string | undefined {
  return FIELD_PLACEHOLDERS[key];
}
