import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { ExternalLink, LogIn, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { AppStatusPill } from "../../../components/app-status-pill.js";
import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useDeleteConnection, useStartOAuth } from "../api/mutations.js";
import { useAppConnections, useConnectionTemplates } from "../api/queries.js";
import { TemplateCreateForm } from "../forms/template-create-form.js";
import { ConnectionIcon } from "./connection-icon.js";

export function ConnectionTemplatesSection() {
  const templates = useConnectionTemplates();
  const connections = useAppConnections();
  const del = useDeleteConnection();
  const startOAuth = useStartOAuth();

  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);

  const onConnect = async (connectionId: string) => {
    const r = (await startOAuth.mutateAsync({ connectionId })) as {
      authUrl: string;
    };
    sessionStorage.setItem("platform-return-view", "connections");
    window.location.href = r.authUrl;
  };

  const byCategory = groupByCategory(templates.data ?? []);
  const iconByTemplateId = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const t of templates.data ?? []) m.set(t.id, t.iconSlug);
    return m;
  }, [templates.data]);

  return (
    <section className="mb-10">
      {(templates.isPending || connections.isPending) && <ListSkeleton />}

      {!templates.isPending &&
        !connections.isPending &&
        (connections.data ?? []).length > 0 && (
          <div className="mb-6">
            <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
              Your Connections
            </div>
            <div className="flex flex-col gap-2">
              {(connections.data ?? []).map((c) => (
                <ConnectionRow
                  key={c.id}
                  connection={c as unknown as ConnectionView}
                  iconSlug={iconByTemplateId.get(c.templateId)}
                  onDelete={() => del.mutate({ id: c.id })}
                  onConnect={() => onConnect(c.id)}
                  connecting={
                    startOAuth.isPending &&
                    startOAuth.variables?.connectionId === c.id
                  }
                  deleting={del.isPending && del.variables?.id === c.id}
                />
              ))}
            </div>
          </div>
        )}

      {!templates.isPending && (
        <div className="flex flex-col gap-5">
          {(["app", "mcp", "other"] as const).map((cat) => {
            const list = byCategory.get(cat) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={cat}>
                <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
                  {categoryLabel(cat)}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {list.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setCreating(t)}
                      className="btn-brutal h-auto py-3 px-4 rounded-lg border-2 border-border-light bg-surface text-left flex items-start gap-3 hover:border-accent transition-colors"
                    >
                      <IconFor template={t} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-text">
                          {t.name}
                        </div>
                        {t.description && (
                          <div className="text-[11px] text-text-muted mt-0.5 truncate">
                            {t.description}
                          </div>
                        )}
                      </div>
                    </button>
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

function ConnectionRow({
  connection,
  iconSlug,
  onDelete,
  onConnect,
  connecting,
  deleting,
}: {
  connection: ConnectionView;
  iconSlug: string | undefined;
  onDelete: () => void;
  onConnect: () => void;
  connecting: boolean;
  deleting: boolean;
}) {
  const needsOAuth =
    connection.authKind === "oauth" && connection.status === "pending";
  const installUrl = githubAppInstallUrl(connection);
  return (
    <div className="flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-3 border-border-light">
      <ConnectionIcon
        iconSlug={iconSlug}
        alt={connection.name}
        size={16}
        className="text-text-secondary shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text truncate">
          {connection.name}
        </div>
        <div className="text-[11px] text-text-muted truncate">
          {connection.hosts.join(", ") || connection.templateId}
        </div>
      </div>
      <AppStatusPill status={connection.status} />
      {needsOAuth && (
        <button
          onClick={onConnect}
          disabled={connecting}
          className="btn-brutal h-8 rounded-lg border-2 border-accent-hover bg-accent px-3 text-[12px] font-bold text-white shadow-brutal-accent disabled:opacity-50 flex items-center gap-1"
          title="Authorize this connection"
        >
          <LogIn size={12} /> Connect
        </button>
      )}
      {installUrl && connection.status === "active" && (
        <a
          href={installUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-brutal h-8 rounded-lg border-2 border-border bg-surface px-3 text-[12px] font-bold text-text shadow-brutal-sm flex items-center gap-1"
          title="Install the GitHub App on the repositories this connection should reach. Required for GitHub App credentials (no effect for OAuth Apps)."
        >
          <ExternalLink size={12} /> Install on GitHub
        </a>
      )}
      <button
        onClick={onDelete}
        disabled={deleting}
        className="h-8 w-8 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-danger hover:border-danger btn-brutal shadow-brutal-sm disabled:opacity-50"
        title="Delete connection"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function githubAppInstallUrl(connection: ConnectionView): string | null {
  if (!connection.appSlug) return null;
  const host =
    connection.templateId === "github-enterprise"
      ? (connection.host ?? null)
      : "github.com";
  if (!host) return null;
  return `https://${host}/apps/${connection.appSlug}/installations/new`;
}

function IconFor({ template }: { template: ConnectionTemplateView }) {
  return (
    <ConnectionIcon
      iconSlug={template.iconSlug}
      alt={template.name}
      size={16}
      className="text-text-secondary mt-0.5 shrink-0"
    />
  );
}

function categoryLabel(c: ConnectionTemplateView["category"]): string {
  return c === "app" ? "Apps" : c === "mcp" ? "MCP Servers" : "Custom";
}

function groupByCategory(
  templates: readonly ConnectionTemplateView[],
): Map<ConnectionTemplateView["category"], ConnectionTemplateView[]> {
  const out = new Map<
    ConnectionTemplateView["category"],
    ConnectionTemplateView[]
  >();
  for (const t of templates) {
    const list = out.get(t.category) ?? [];
    list.push(t);
    out.set(t.category, list);
  }
  return out;
}
