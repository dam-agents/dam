import {
  type ConnectionTemplateView,
  type ConnectionView,
  PROVIDER_TEMPLATE_IDS,
} from "api-server-api";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo, useState } from "react";

import { SectionLabel } from "@/components/ui/section-label";

import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import {
  ConnectionAction,
  ConnectionCatalogRow,
  ConnectionRow,
} from "../../connections/components/connection-row.js";
import { TemplateCreateForm } from "../../connections/forms/template-create-form.js";
import { useDisconnectConnection } from "../../connections/hooks/use-disconnect-connection.js";
import {
  filterOfferedTemplates,
  isShowInternalConnectionsEnabled,
} from "../../connections/internal-only.js";
import { excludeProviderConnections } from "../lib/provider-connections.js";
import { CardList } from "./card-list.js";

const NO_TEMPLATES: ConnectionTemplateView[] = [];
const NO_CONNECTIONS: ConnectionView[] = [];

const CATEGORY_ORDER = ["app", "mcp", "other"] as const;
const CATEGORY_LABEL: Record<(typeof CATEGORY_ORDER)[number], string> = {
  app: "Apps",
  mcp: "MCP servers",
  other: "Other",
};

interface Props {
  grantedIds: ReadonlySet<string>;
  onToggleGrant: (id: string, on: boolean) => void;
  oauthReturnView: string;
}

export function ConnectionsSection({
  grantedIds,
  onToggleGrant,
  oauthReturnView,
}: Props) {
  const templatesQ = useConnectionTemplates();
  const connectionsQ = useAppConnections();
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);
  const [showCatalog, setShowCatalog] = useState(false);

  const allTemplates = templatesQ.data ?? NO_TEMPLATES;
  const connections = excludeProviderConnections(
    connectionsQ.data ?? NO_CONNECTIONS,
  );

  const templateById = useMemo(
    () => new Map(allTemplates.map((t) => [t.id, t])),
    [allTemplates],
  );

  // Deleting a granted connection must also drop its staged grant — a stale
  // id in the form would make Save fail with "not owned by caller" (#2426).
  const disconnect = async (id: string, name: string) => {
    if ((await confirmAndDelete(id, name)) && grantedIds.has(id))
      onToggleGrant(id, false);
  };

  const showInternal = isShowInternalConnectionsEnabled();
  const byCategory = useMemo(() => {
    const m = new Map<string, ConnectionTemplateView[]>();
    for (const t of filterOfferedTemplates(allTemplates, showInternal)) {
      if (PROVIDER_TEMPLATE_IDS.has(t.id)) continue;
      const list = m.get(t.category) ?? [];
      list.push(t);
      m.set(t.category, list);
    }
    return m;
  }, [allTemplates, showInternal]);

  return (
    <>
      <section className="mb-8">
        <SectionLabel spaced>My connections</SectionLabel>
        {connections.length > 0 ? (
          <CardList>
            {connections.map((c) => (
              <ConnectionRow
                key={c.id}
                title={templateById.get(c.templateId)?.name ?? c.templateId}
                subtitle={c.name}
                iconSlug={templateById.get(c.templateId)?.iconSlug}
                status={c.status}
                selectable
                selected={grantedIds.has(c.id)}
                onSelectedChange={(on) => onToggleGrant(c.id, on)}
                testId={`connection-grant-${c.id}`}
              >
                <ConnectionAction
                  label="Disconnect"
                  tone="danger"
                  onClick={() => void disconnect(c.id, c.name)}
                  disabled={deletingId === c.id}
                />
              </ConnectionRow>
            ))}
          </CardList>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            No connections yet.
          </p>
        )}
        <button
          type="button"
          onClick={() => setShowCatalog((v) => !v)}
          className="mt-3 inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
        >
          {showCatalog ? "Show less" : "Show all"}
          {showCatalog ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </section>

      {showCatalog &&
        CATEGORY_ORDER.map((cat) => {
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
          onCreated={(id) => {
            setCreating(null);
            onToggleGrant(id, true);
          }}
          onCancel={() => setCreating(null)}
          popupOAuth
          oauthReturnView={oauthReturnView}
        />
      )}
    </>
  );
}
