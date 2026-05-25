import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { KeyRound, Plug, Server, Trash2 } from "lucide-react";
import { useState } from "react";

import { AppStatusPill } from "../../../components/app-status-pill.js";
import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useDeleteConnection } from "../api/mutations.js";
import { useAppConnections, useConnectionTemplates } from "../api/queries.js";
import { TemplateCreateForm } from "../forms/template-create-form.js";

/**
 * Connection-Template-driven section of the Connections view (ADR-051).
 * Lists the code-declared templates grouped by `category` and the existing
 * Connections the user has minted. The legacy OAuth / MCP / Secrets
 * sections coexist while their flows migrate to Templates.
 *
 * UX:
 *   - Templates render as "Add" buttons grouped by category.
 *   - Existing connections render as rows with status + delete.
 *   - Click a template button → modal form with template-specific inputs.
 *   - Server creates the Connection in one round-trip; the list refetches.
 */
export function ConnectionTemplatesSection() {
  const templates = useConnectionTemplates();
  const connections = useAppConnections();
  const del = useDeleteConnection();

  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);

  const byCategory = groupByCategory(templates.data ?? []);

  return (
    <section className="mb-10">
      <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
        Connection Templates
      </h2>
      <p className="text-[12px] text-text-muted mb-4">
        Code-declared catalog entries (ADR-051). Pick a template to add a new
        Connection — the server validates inputs and writes credentials to the
        configured secret store.
      </p>

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
                  /* tRPC client mints a structurally-equal but nominally
                     distinct ConnectionView — cast. */
                  connection={c as unknown as ConnectionView}
                  onDelete={() => del.mutate({ id: c.id })}
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
  onDelete,
  deleting,
}: {
  connection: ConnectionView;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border-2 bg-bg px-4 py-3 border-border-light">
      <Plug size={14} className="text-text-secondary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-text truncate">
          {connection.name}
        </div>
        <div className="text-[11px] text-text-muted truncate">
          {connection.hosts.join(", ") || connection.templateId}
        </div>
      </div>
      <AppStatusPill status={connection.status} />
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

function IconFor({ template }: { template: ConnectionTemplateView }) {
  if (template.category === "mcp") {
    return <Server size={14} className="text-text-secondary mt-0.5 shrink-0" />;
  }
  return <KeyRound size={14} className="text-text-secondary mt-0.5 shrink-0" />;
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
