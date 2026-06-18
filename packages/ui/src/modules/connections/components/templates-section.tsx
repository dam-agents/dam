import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { useMemo, useState } from "react";

import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStartOAuth } from "../api/mutations.js";
import { useAppConnections, useConnectionTemplates } from "../api/queries.js";
import { TemplateCreateForm } from "../forms/template-create-form.js";
import { useDisconnectConnection } from "../hooks/use-disconnect-connection.js";
import {
  filterOfferedTemplates,
  isShowInternalConnectionsEnabled,
} from "../internal-only.js";
import { PROVIDER_TEMPLATE_IDS } from "../lib/provider-templates.js";
import {
  ConnectionAction,
  ConnectionCatalogRow,
  ConnectionRow,
} from "./connection-row.js";
import { GithubAppInstallLink } from "./github-app-install-link.js";

const NO_TEMPLATES: ConnectionTemplateView[] = [];
const NO_CONNECTIONS: ConnectionView[] = [];

const CATEGORY_ORDER = ["app", "mcp", "other"] as const;
const CATEGORY_LABEL: Record<(typeof CATEGORY_ORDER)[number], string> = {
  app: "Apps",
  mcp: "MCP servers",
  other: "Other",
};

export function ConnectionTemplatesSection() {
  const templates = useConnectionTemplates();
  const connections = useAppConnections();
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const startOAuth = useStartOAuth();

  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);

  const onAuthorize = async (connectionId: string) => {
    const r = (await startOAuth.mutateAsync({ connectionId })) as {
      authUrl: string;
    };
    sessionStorage.setItem("platform-return-view", "/settings/connections");
    window.location.href = r.authUrl;
  };

  const allTemplates = templates.data ?? NO_TEMPLATES;
  const conns = (connections.data ??
    NO_CONNECTIONS) as unknown as ConnectionView[];
  const templateById = useMemo(
    () => new Map(allTemplates.map((t) => [t.id, t])),
    [allTemplates],
  );
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

  const loading = templates.isPending || connections.isPending;

  return (
    <section className="mb-10">
      {loading && <ListSkeleton />}

      {!loading && conns.length > 0 && (
        <div className="mb-8">
          <SectionLabel spaced>My connections</SectionLabel>
          <div className="flex flex-col gap-3">
            {conns.map((c) => (
              <ConnectionRow
                key={c.id}
                title={templateById.get(c.templateId)?.name ?? c.templateId}
                subtitle={c.name}
                iconSlug={templateById.get(c.templateId)?.iconSlug}
                status={c.status}
              >
                <ConnectionActions
                  connection={c}
                  onAuthorize={() => onAuthorize(c.id)}
                  onDelete={() => void confirmAndDelete(c.id, c.name)}
                  authorizing={
                    startOAuth.isPending &&
                    startOAuth.variables?.connectionId === c.id
                  }
                  deleting={deletingId === c.id}
                />
              </ConnectionRow>
            ))}
          </div>
        </div>
      )}

      {!templates.isPending && (
        <div className="flex flex-col gap-6">
          {CATEGORY_ORDER.map((cat) => {
            const list = byCategory.get(cat) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={cat}>
                <SectionLabel spaced>{CATEGORY_LABEL[cat]}</SectionLabel>
                <div className="flex flex-col gap-3">
                  {list.map((t) => (
                    <ConnectionCatalogRow
                      key={t.id}
                      template={t}
                      onConnect={() => setCreating(t)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {creating && (
        <TemplateCreateForm
          template={creating}
          onCreated={() => setCreating(null)}
          onCancel={() => setCreating(null)}
        />
      )}
    </section>
  );
}

function ConnectionActions({
  connection,
  onAuthorize,
  onDelete,
  authorizing,
  deleting,
}: {
  connection: ConnectionView;
  onAuthorize: () => void;
  onDelete: () => void;
  authorizing: boolean;
  deleting: boolean;
}) {
  if (connection.authKind === "oauth" && connection.status === "pending") {
    return (
      <ConnectionAction
        label="Connect"
        onClick={onAuthorize}
        disabled={authorizing}
      />
    );
  }
  return (
    <div className="flex shrink-0 items-center gap-4">
      <GithubAppInstallLink connection={connection} />
      <ConnectionAction
        label="Disconnect"
        tone="danger"
        onClick={onDelete}
        disabled={deleting}
      />
    </div>
  );
}
