import type { ConnectionTemplateView } from "api-server-api";
import { PROVIDER_PRESET_TYPES } from "api-server-api";
import { ArrowRight, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { TemplateCreateForm } from "../../connections/forms/template-create-form.js";
import { useSandboxWizard } from "../../v2/hooks/use-sandbox-wizard.js";
import { saveSnapshot } from "../../v2/lib/wizard-snapshot.js";
import { WizardLayout } from "../components/wizard-layout.js";

const PROVIDER_PRESET_TEMPLATE_IDS = new Set<string>(PROVIDER_PRESET_TYPES);

// Connections intentionally hidden from the sandbox-creation flow.
const HIDDEN_TEMPLATE_IDS = new Set<string>(["spotify", "slack", "youtube"]);
const isHiddenTemplate = (id: string) =>
  HIDDEN_TEMPLATE_IDS.has(id) || id.startsWith("google-");

export function ConnectionsStepView() {
  const { snapshot, update } = useSandboxWizard();
  const setView = useStore((s) => s.setView);
  const { data: templates = [] } = useConnectionTemplates();
  const { data: connections = [] } = useAppConnections();

  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);

  // Resume after a popup-blocked OAuth redirect lands back on /new/connections:
  // the connection id was already pushed into the snapshot before redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("oauth");
    if (!result) return;
    window.history.replaceState({}, "", "/new/connections");
    if (result !== "success")
      emitToast({
        kind: "error",
        message: `Authorization failed: ${params.get("message") ?? "unknown error"}`,
      });
  }, []);

  const groups = useMemo(() => groupTemplates(templates), [templates]);

  const addConnection = (id: string) => {
    if (!snapshot.connectionIds.includes(id))
      update({ connectionIds: [...snapshot.connectionIds, id] });
  };

  // A template counts as connected when one of its connections is in the
  // snapshot and live-active (OAuth) — or simply present (no-auth/header).
  const isConnected = (template: ConnectionTemplateView) =>
    connections.some(
      (c) =>
        c.templateId === template.id &&
        snapshot.connectionIds.includes(c.id) &&
        c.status !== "pending",
    );

  const next = () => setView("new-context");

  return (
    <WizardLayout
      current="new-connections"
      title="Grant connections"
      subtitle="Choose which app connections and credentials this agent can access."
      onStepClick={setView}
      footer={
        <>
          <Button variant="outline" onClick={next}>
            Skip this step
          </Button>
          <Button onClick={next}>
            Continue <ArrowRight size={15} />
          </Button>
        </>
      }
    >
      {GROUP_ORDER.map((cat) => {
        const list = groups.get(cat);
        if (!list || list.length === 0) return null;
        return (
          <div key={cat} className="flex flex-col gap-3">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
              {GROUP_LABELS[cat]}
            </span>
            {list.map((template) => (
              <ConnectionRow
                key={template.id}
                template={template}
                connected={isConnected(template)}
                onConnect={() => setCreating(template)}
              />
            ))}
          </div>
        );
      })}

      {creating && (
        <TemplateCreateForm
          template={creating}
          returnTo="/new/connections"
          onBeforeOAuthRedirect={(id) => {
            saveSnapshot({
              ...snapshot,
              connectionIds: [...snapshot.connectionIds, id],
            });
          }}
          onCreated={(id) => {
            addConnection(id);
            setCreating(null);
          }}
          onCancel={() => setCreating(null)}
        />
      )}
    </WizardLayout>
  );
}

function ConnectionRow({
  template,
  connected,
  onConnect,
}: {
  template: ConnectionTemplateView;
  connected: boolean;
  onConnect: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border px-4 py-3">
      <ConnectionIcon
        iconSlug={template.iconSlug}
        alt={template.name}
        size={20}
        className="mt-0.5 shrink-0 text-foreground"
      />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-foreground">
          {template.name}
        </div>
        {template.description && (
          <div className="text-[12px] text-muted-foreground">
            {template.description}
          </div>
        )}
      </div>
      {connected ? (
        <span className="flex shrink-0 items-center gap-1 text-[13px] text-success">
          <Check size={15} /> Connected
        </span>
      ) : (
        <button
          type="button"
          onClick={onConnect}
          className="shrink-0 text-[13px] font-semibold text-primary hover:underline"
        >
          Connect
        </button>
      )}
    </div>
  );
}

type Category = ConnectionTemplateView["category"];
const GROUP_ORDER: readonly Category[] = ["app", "mcp", "other"];
const GROUP_LABELS: Record<Category, string> = {
  app: "Apps",
  mcp: "MCP Servers",
  other: "Custom",
};

function groupTemplates(
  templates: readonly ConnectionTemplateView[],
): Map<Category, ConnectionTemplateView[]> {
  const out = new Map<Category, ConnectionTemplateView[]>();
  for (const t of templates) {
    // LLM provider presets belong to the configure step's credential picker.
    if (PROVIDER_PRESET_TEMPLATE_IDS.has(t.id)) continue;
    if (isHiddenTemplate(t.id)) continue;
    const list = out.get(t.category) ?? [];
    list.push(t);
    out.set(t.category, list);
  }
  return out;
}
