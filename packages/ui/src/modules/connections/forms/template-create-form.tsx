import { ChevronDown as ChevronDownIcon } from "@carbon/icons-react";
import {
  type ConnectionCreateInput,
  connectionNameSchema,
  type ConnectionTemplateInput,
  type ConnectionTemplateView,
} from "api-server-api";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useCreateConnection } from "../api/mutations.js";
import { openOAuthPopup } from "../lib/oauth-popup.js";

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
        // Open OAuth in a popup so the parent tab (and any in-progress agent
        // creation modal underneath) survives the round-trip. The popup
        // broadcasts back via BroadcastChannel — see oauth-popup.ts.
        const oauthResult = await openOAuthPopup(r.authUrl);
        setAuthorizing(false);
        if (oauthResult.status === "error") {
          setError(oauthResult.message ?? "OAuth failed");
          return;
        }
        await queryClient.invalidateQueries({
          queryKey: trpc.connections.list.queryKey(),
        });
        onCreated(result.id);
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
    <Dialog open onOpenChange={(o) => !o && !pending && onCancel()}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Add {template.name}</DialogTitle>
          {template.description && (
            <DialogDescription>{template.description}</DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <LabeledInput
            label="Name"
            placeholder="my-connection"
            value={name}
            onChange={setName}
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

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={pending}>
            {authorizing
              ? "Authorizing…"
              : pending
                ? "…"
                : needsOAuth
                  ? "Create + Authorize"
                  : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  // Default to expanded so the customized-defaults are visible up-front —
  // the meeting flagged that hiding them behind a chevron made users miss
  // they could override clientId / clientSecret / appSlug for GitHub.
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="rounded-lg border border-dashed p-3">
      <button
        type="button"
        className="text-[12px] font-semibold text-foreground hover:text-primary inline-flex items-center gap-1"
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronDownIcon
          className={cn(
            "h-3 w-3 transition-transform",
            !expanded && "-rotate-90",
          )}
        />{" "}
        Customize defaults ({inputs.length})
      </button>
      <p className="text-[11px] text-muted-foreground mt-1">
        These values are pre-configured by your administrator. Leave as-is to
        use the defaults.
      </p>
      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          {inputs.map((input) => {
            const overriding = overrides[input.name] === true;
            return (
              <div key={input.name} className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={overriding}
                    onCheckedChange={(v) => setOverride(input.name, v === true)}
                  />
                  <span className="text-[12px] font-semibold text-foreground">
                    Override {labelFor(input.name).toLowerCase()}
                  </span>
                </Label>
                {!overriding && input.presetValue && (
                  <p className="text-[11px] font-mono text-muted-foreground pl-6">
                    Preset: {input.presetValue}
                  </p>
                )}
                {!overriding && !input.presetValue && input.secret && (
                  <p className="text-[11px] text-muted-foreground pl-6">
                    Preset value hidden.
                  </p>
                )}
                {overriding && (
                  <Input
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
    <div className="flex flex-col gap-1.5">
      <Label className="text-[12px] font-semibold text-foreground">
        {label}
      </Label>
      <Input
        type={type ?? "text"}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      {help && (
        <span className="text-[11px] text-muted-foreground">{help}</span>
      )}
    </div>
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
