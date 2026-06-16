import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { useDeleteConnection } from "../../../connections/api/mutations.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../../connections/api/queries.js";
import { TemplateCreateForm } from "../../../connections/forms/template-create-form.js";
import {
  filterOfferedTemplates,
  isShowInternalConnectionsEnabled,
} from "../../../connections/internal-only.js";
import { PROVIDER_TEMPLATE_IDS } from "../../../connections/lib/provider-templates.js";
import {
  saveSnapshot,
  type WizardSnapshot,
} from "../../lib/wizard-snapshot.js";
import { CatalogConnectionRow, MyConnectionRow } from "../connection-row.js";
import { StepHeader } from "../step-header.js";
import { WizardSectionLabel } from "../wizard-section-label.js";

const NO_TEMPLATES: ConnectionTemplateView[] = [];

const CATEGORY_ORDER = ["app", "mcp", "other"] as const;
const CATEGORY_LABEL: Record<(typeof CATEGORY_ORDER)[number], string> = {
  app: "Apps",
  mcp: "MCP servers",
  other: "Other",
};

interface Props {
  snapshot: WizardSnapshot;
  update: (patch: Partial<WizardSnapshot>) => void;
  onFinish: () => void;
  finishing: boolean;
}

export function ConnectionsStep({
  snapshot,
  update,
  onFinish,
  finishing,
}: Props) {
  const templatesQ = useConnectionTemplates();
  const connectionsQ = useAppConnections();
  const del = useDeleteConnection();
  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);

  const allTemplates = templatesQ.data ?? NO_TEMPLATES;
  const connections = (connectionsQ.data ?? []) as unknown as ConnectionView[];

  const templateById = useMemo(
    () => new Map(allTemplates.map((t) => [t.id, t])),
    [allTemplates],
  );

  const showInternal = isShowInternalConnectionsEnabled();

  const byCategory = useMemo(() => {
    const offered = filterOfferedTemplates(allTemplates, showInternal);
    const m = new Map<string, ConnectionTemplateView[]>();
    for (const t of offered) {
      if (PROVIDER_TEMPLATE_IDS.has(t.id)) continue;
      const list = m.get(t.category) ?? [];
      list.push(t);
      m.set(t.category, list);
    }
    return m;
  }, [allTemplates, showInternal]);

  const selected = new Set(snapshot.connectionIds);

  const toggle = (id: string, on: boolean) =>
    update({
      connectionIds: on
        ? [...new Set([...snapshot.connectionIds, id])]
        : snapshot.connectionIds.filter((x) => x !== id),
    });

  const disconnect = (id: string) => {
    del.mutate({ id });
    if (selected.has(id))
      update({ connectionIds: snapshot.connectionIds.filter((x) => x !== id) });
  };

  const onCreated = (id: string) => {
    setCreating(null);
    update({ connectionIds: [...new Set([...snapshot.connectionIds, id])] });
  };

  // Persist synchronously before the full-page OAuth redirect leaves the page.
  const onOAuthRedirect = (id: string) =>
    saveSnapshot({
      ...snapshot,
      pendingConnectionId: id,
      connectionIds: [...new Set([...snapshot.connectionIds, id])],
    });

  return (
    <div>
      <StepHeader
        step={3}
        title="Grant connections"
        subtitle="Choose which app connections and credentials this sandbox can access."
      />

      {connections.length > 0 && (
        <section className="mb-8">
          <WizardSectionLabel>My connections</WizardSectionLabel>
          <div className="flex flex-col gap-3">
            {connections.map((c) => (
              <MyConnectionRow
                key={c.id}
                title={templateById.get(c.templateId)?.name ?? c.templateId}
                subtitle={c.name}
                iconSlug={templateById.get(c.templateId)?.iconSlug}
                active={c.status === "active"}
                selected={selected.has(c.id)}
                onToggle={(on) => toggle(c.id, on)}
                onDisconnect={() => disconnect(c.id)}
                testId={`connection-grant-${c.id}`}
              />
            ))}
          </div>
        </section>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const list = byCategory.get(cat) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={cat} className="mb-8">
            <WizardSectionLabel>{CATEGORY_LABEL[cat]}</WizardSectionLabel>
            <div className="flex flex-col gap-3">
              {list.map((t) => (
                <CatalogConnectionRow
                  key={t.id}
                  template={t}
                  onConnect={() => setCreating(t)}
                />
              ))}
            </div>
          </section>
        );
      })}

      <div className="flex justify-end gap-3">
        {selected.size === 0 && (
          <Button variant="outline" onClick={onFinish} disabled={finishing}>
            Skip this step
          </Button>
        )}
        <Button onClick={onFinish} disabled={finishing}>
          {selected.size > 0 ? (
            "Create sandbox"
          ) : (
            <>
              Continue <ArrowRight size={16} />
            </>
          )}
        </Button>
      </div>

      {creating && (
        <TemplateCreateForm
          template={creating}
          onCreated={onCreated}
          onCancel={() => setCreating(null)}
          popupOAuth
          oauthReturnView="/sandboxes/new"
          onOAuthRedirect={onOAuthRedirect}
        />
      )}
    </div>
  );
}
