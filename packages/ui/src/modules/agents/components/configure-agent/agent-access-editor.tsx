import { TrashCan } from "@carbon/icons-react";
import type {
  AppConnectionView,
  ConnectionTemplateView,
  SecretView,
} from "api-server-api";
import { isProviderPresetType, PROVIDER_PRESET_TYPES } from "api-server-api";
import { Check, Plus } from "lucide-react";
import { useState } from "react";

import { ConnectionIcon } from "../../../connections/components/connection-icon.js";
import { TemplateCreateForm } from "../../../connections/forms/template-create-form.js";
import { ProviderSection } from "../../../journey/components/provider-section.js";
import {
  findReusableSecret,
  LLM_PROVIDERS,
} from "../../../v2/lib/llm-providers.js";

const PROVIDER_PRESET_TEMPLATE_IDS = new Set<string>(PROVIDER_PRESET_TYPES);
const HIDDEN_TEMPLATE_IDS = new Set<string>(["spotify", "slack", "youtube"]);

/** Providers tab: the unified provider list (connected sorted top, gear to
 *  change/delete, hover-to-remove). A sandbox uses one provider, so granting a
 *  new one replaces the prior. */
export function ProvidersTab({
  secrets,
  assignedSecretIds,
  onGrantSecret,
  onRevokeSecret,
}: {
  secrets: SecretView[];
  assignedSecretIds: ReadonlySet<string>;
  onGrantSecret: (id: string) => void;
  onRevokeSecret: (id: string) => void;
}) {
  // The single connected provider key (if any) + its provider id.
  const connectedSecret = secrets.find(
    (s) => isProviderPresetType(s.type) && assignedSecretIds.has(s.id),
  );
  const connectedProvider =
    connectedSecret &&
    LLM_PROVIDERS.find((p) => findReusableSecret(p, [connectedSecret]));

  return (
    <ProviderSection
      selectedProvider={connectedProvider?.id ?? null}
      selectedSecretId={connectedSecret?.id ?? null}
      onSelect={(_p, secretId) => {
        if (connectedSecret && connectedSecret.id !== secretId)
          onRevokeSecret(connectedSecret.id);
        onGrantSecret(secretId);
      }}
      onDisconnect={() => {
        if (connectedSecret) onRevokeSecret(connectedSecret.id);
      }}
    />
  );
}

/** Connections tab: the app / MCP connections granted to this agent, each
 *  removable, plus an inline "add a connection" create flow. */
export function ConnectionsTab({
  apps,
  templates,
  assignedAppIds,
  onRevokeApp,
  onGrantApp,
}: {
  apps: AppConnectionView[];
  templates: ConnectionTemplateView[];
  assignedAppIds: ReadonlySet<string>;
  onRevokeApp: (id: string) => void;
  onGrantApp: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);

  const granted = apps.filter((a) => assignedAppIds.has(a.id));
  const addableTemplates = templates.filter(
    (t) =>
      !PROVIDER_PRESET_TEMPLATE_IDS.has(t.id) &&
      !HIDDEN_TEMPLATE_IDS.has(t.id) &&
      !t.id.startsWith("google-"),
  );

  return (
    <div className="flex flex-col gap-4">
      {granted.length === 0 ? (
        <Empty>No connections yet.</Empty>
      ) : (
        granted.map((a) => (
          <ConnectionRow
            key={a.id}
            connection={a}
            onRemove={() => onRevokeApp(a.id)}
          />
        ))
      )}
      {adding ? (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
          {addableTemplates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setCreating(t)}
              className="flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-muted"
            >
              <ConnectionIcon
                iconSlug={t.iconSlug}
                alt={t.name}
                size={18}
                className="shrink-0 text-foreground"
              />
              <span className="text-[13px] font-semibold text-foreground">
                {t.name}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="self-start text-[12px] text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 self-start text-[13px] font-semibold text-primary hover:underline"
        >
          <Plus size={15} /> Add a connection
        </button>
      )}

      {creating && (
        <TemplateCreateForm
          template={creating}
          onCreated={(id) => {
            onGrantApp(id);
            setCreating(null);
            setAdding(false);
          }}
          onCancel={() => setCreating(null)}
        />
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] text-muted-foreground">{children}</p>;
}

function ConnectionRow({
  connection,
  onRemove,
}: {
  connection: AppConnectionView;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-foreground">
          {connection.name}
        </div>
        <div className="truncate text-[12px] text-muted-foreground">
          {connection.hosts.join(", ") || connection.templateId}
        </div>
      </div>
      {connection.status === "active" && (
        <span className="flex items-center gap-1 text-[12px] text-success">
          <Check size={13} /> Active
        </span>
      )}
      <button
        type="button"
        title="Remove from this agent"
        onClick={onRemove}
        className="text-muted-foreground hover:text-destructive"
      >
        <TrashCan />
      </button>
    </div>
  );
}
