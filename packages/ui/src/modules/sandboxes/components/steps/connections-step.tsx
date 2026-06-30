import {
  type ConnectionTemplateView,
  PROVIDER_TEMPLATE_IDS,
} from "api-server-api";
import { useMemo, useState } from "react";

import { SectionLabel } from "@/components/ui/section-label";

import {
  useAppConnections,
  useConnectionTemplates,
} from "../../../connections/api/queries.js";
import {
  ConnectionAction,
  ConnectionCatalogRow,
  ConnectionRow,
} from "../../../connections/components/connection-row.js";
import { GithubAppInstallLink } from "../../../connections/components/github-app-install-link.js";
import { TemplateCreateForm } from "../../../connections/forms/template-create-form.js";
import { useDisconnectConnection } from "../../../connections/hooks/use-disconnect-connection.js";
import {
  filterOfferedTemplates,
  isShowInternalConnectionsEnabled,
} from "../../../connections/internal-only.js";
import { excludeProviderConnections } from "../../lib/provider-connections.js";
import {
  saveSnapshot,
  type WizardSnapshot,
} from "../../lib/wizard-snapshot.js";
import { CardList } from "../card-list.js";
import { StepHeader } from "../step-header.js";

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
}

export function ConnectionsStep({ snapshot, update }: Props) {
  const templatesQ = useConnectionTemplates();
  const connectionsQ = useAppConnections();
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);

  const allTemplates = templatesQ.data ?? NO_TEMPLATES;
  const connections = excludeProviderConnections(connectionsQ.data ?? []);

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

  const disconnect = async (id: string, name: string) => {
    if ((await confirmAndDelete(id, name)) && selected.has(id))
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
          <SectionLabel spaced>My connections</SectionLabel>
          <CardList>
            {connections.map((c) => (
              <ConnectionRow
                key={c.id}
                title={templateById.get(c.templateId)?.name ?? c.templateId}
                subtitle={c.name}
                iconSlug={templateById.get(c.templateId)?.iconSlug}
                status={c.status}
                selectable
                selected={selected.has(c.id)}
                onSelectedChange={(on) => toggle(c.id, on)}
                testId={`connection-grant-${c.id}`}
              >
                <div className="flex shrink-0 items-center gap-4">
                  <GithubAppInstallLink connection={c} />
                  <ConnectionAction
                    label="Disconnect"
                    tone="danger"
                    onClick={() => void disconnect(c.id, c.name)}
                    disabled={deletingId === c.id}
                  />
                </div>
              </ConnectionRow>
            ))}
          </CardList>
        </section>
      )}

      {CATEGORY_ORDER.map((cat) => {
        const list = byCategory.get(cat) ?? [];
        if (list.length === 0) return null;
        return (
          <section key={cat} className="mb-8">
            <SectionLabel spaced>{CATEGORY_LABEL[cat]}</SectionLabel>
            <CardList>
              {list.map((t) => (
                <ConnectionCatalogRow
                  key={t.id}
                  template={t}
                  onConnect={() => setCreating(t)}
                />
              ))}
            </CardList>
          </section>
        );
      })}

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
