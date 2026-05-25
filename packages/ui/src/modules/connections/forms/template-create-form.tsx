import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "../../../components/modal.js";
import { useCreateConnection, useStartOAuth } from "../api/mutations.js";

const INPUT_CLASS =
  "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

/**
 * Template-driven Connection-create form (ADR-051). The Connection
 * Template catalog drives this UI: each template declares the inputs the
 * user must supply; the server validates them against the template's Zod
 * schema and projects them into the Connection's auth + contributions.
 *
 * Today we hand-render fields for the templates we ship — `custom-header`
 * and `custom-mcp`. A schema-driven renderer (reading template.inputs from
 * the wire) is a small follow-up; for now the per-template form is a thin
 * switch keyed on template.id.
 */
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
  const startOAuth = useStartOAuth();
  const [name, setName] = useState("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const fields = fieldsForTemplate(template.id);
  const needsOAuth = template.authKinds.includes("oauth");
  const pending = create.isPending || startOAuth.isPending;

  const submit = async () => {
    setError(null);
    try {
      const result = (await create.mutateAsync({
        templateId: template.id,
        name: name.trim() || undefined,
        inputs,
      })) as { id: string };
      if (needsOAuth) {
        // Hand off to the OAuth flow immediately so the user only sees one
        // "Add GitHub" → authorize-at-provider step. Skipping this would
        // leave the Connection in `pending` until the user clicks Connect
        // in the row.
        const r = (await startOAuth.mutateAsync({
          connectionId: result.id,
        })) as {
          authUrl: string;
        };
        sessionStorage.setItem("platform-return-view", "connections");
        window.location.href = r.authUrl;
        return;
      }
      onCreated(result.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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
          <label className="block">
            <span className="text-[12px] font-semibold text-text-secondary block mb-1">
              Display name (optional)
            </span>
            <input
              className={INPUT_CLASS}
              placeholder="My connection"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>

          {fields.map((f) => (
            <label key={f.key} className="block">
              <span className="text-[12px] font-semibold text-text-secondary block mb-1">
                {f.label}
              </span>
              <input
                className={INPUT_CLASS}
                type={f.kind === "secret" ? "password" : "text"}
                placeholder={f.placeholder}
                value={inputs[f.key] ?? ""}
                onChange={(e) =>
                  setInputs((prev) => ({ ...prev, [f.key]: e.target.value }))
                }
              />
            </label>
          ))}

          {fields.length === 0 && (
            <p className="text-[12px] text-text-muted">
              No additional inputs — this template is preconfigured.
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
          className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={pending}
          className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
        >
          {pending ? "…" : needsOAuth ? "Create + Authorize" : "Create"}
        </button>
      </DialogFooter>
    </Modal>
  );
}

interface FormFieldSpec {
  key: string;
  label: string;
  placeholder?: string;
  kind: "text" | "secret";
}

/**
 * Per-template input rendering. Mirrors each template's Zod `inputs`
 * schema. The mapping lives here (not in the template's `toView()`) so
 * the wire payload stays minimal — templates declare *what* they need,
 * the UI maps each id to the right form.
 */
function fieldsForTemplate(templateId: string): FormFieldSpec[] {
  switch (templateId) {
    case "custom-header":
      return [
        {
          key: "host",
          label: "Host",
          placeholder: "api.example.com",
          kind: "text",
        },
        {
          key: "headerName",
          label: "Header name",
          placeholder: "X-API-Key",
          kind: "text",
        },
        {
          key: "valueFormat",
          label: "Value format",
          placeholder: "{value}",
          kind: "text",
        },
        {
          key: "value",
          label: "Secret value",
          placeholder: "•••••",
          kind: "secret",
        },
      ];
    case "custom-mcp":
      return [
        {
          key: "url",
          label: "MCP server URL",
          placeholder: "https://mcp.example.com/sse",
          kind: "text",
        },
        {
          key: "authMode",
          label: "Auth mode (none | bearer)",
          placeholder: "none",
          kind: "text",
        },
        {
          key: "token",
          label: "Bearer token (only if authMode=bearer)",
          placeholder: "•••••",
          kind: "secret",
        },
      ];
    default:
      return [];
  }
}

export type CreatedConnection = Pick<ConnectionView, "id" | "templateId">;
