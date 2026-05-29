import { Add as Plus } from "@carbon/icons-react";
import {
  type ConnectionTemplateView,
  type ConnectionView,
  PROVIDER_PRESET_TYPES,
} from "api-server-api";
import { useMemo, useState } from "react";

const PROVIDER_PRESET_TEMPLATE_IDS = new Set<string>(PROVIDER_PRESET_TYPES);

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { emitToast } from "../../../lib/toast-sink.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useDeleteConnection, useStartOAuth } from "../api/mutations.js";
import { useAppConnections, useConnectionTemplates } from "../api/queries.js";
import { ConnectionChooserDialog } from "../components/connection-chooser-dialog.js";
import { ConnectionRow } from "../components/connection-row.js";
import { TemplateCreateForm } from "../forms/template-create-form.js";
import { openOAuthPopup } from "../lib/oauth-popup.js";

export function ConnectionsView() {
  const templates = useConnectionTemplates();
  const connections = useAppConnections();
  const del = useDeleteConnection();
  const startOAuth = useStartOAuth();

  const [chooserOpen, setChooserOpen] = useState(false);
  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);

  const visibleTemplates = useMemo(
    () =>
      (templates.data ?? []).filter(
        (t) => !PROVIDER_PRESET_TEMPLATE_IDS.has(t.id),
      ),
    [templates.data],
  );

  const iconByTemplateId = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const t of templates.data ?? []) m.set(t.id, t.iconSlug);
    return m;
  }, [templates.data]);

  const onConnect = async (connectionId: string) => {
    const r = (await startOAuth.mutateAsync({ connectionId })) as {
      authUrl: string;
    };
    try {
      const oauthResult = await openOAuthPopup(r.authUrl);
      if (oauthResult.status === "error") {
        emitToast({
          kind: "error",
          message: `OAuth failed: ${oauthResult.message ?? "Unknown error"}`,
        });
        return;
      }
      emitToast({ kind: "success", message: "Connection authorized." });
      await queryClient.invalidateQueries({
        queryKey: trpc.connections.list.queryKey(),
      });
    } catch (err) {
      emitToast({
        kind: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const isPending = templates.isPending || connections.isPending;
  // A connection that never finished OAuth is in `pending` status — the
  // record exists but no token was minted, so treat it as not-connected
  // and keep it out of the cards list. Surfacing pending records here
  // would imply the connection works when it doesn't.
  const items = (connections.data ?? []).filter(
    (c) => c.status !== "pending",
  ) as readonly ConnectionView[];
  const hasAny = items.length > 0;

  return (
    <div className="w-full max-w-2xl">
      {/* Header + page description only render once at least one connection
          exists. Empty state owns the page title + primary CTA otherwise,
          mirroring the Providers page pattern. */}
      {hasAny && (
        <>
          <header className="flex items-center gap-3 mb-4">
            <h1 className="text-[20px] md:text-[24px] font-bold text-foreground">
              Connections
            </h1>
            <div className="ml-auto">
              <Button onClick={() => setChooserOpen(true)}>
                <Plus />
                <span className="hidden sm:inline">Add</span> Connection
              </Button>
            </div>
          </header>

          <p className="text-[14px] text-foreground/80 mb-8 leading-relaxed">
            External services and credentials available to your agents. Injected
            into outbound HTTP requests — agents never see raw tokens.
          </p>
        </>
      )}

      {isPending && <ListSkeleton />}

      {!isPending && hasAny && (
        <section className="mb-10 flex flex-col gap-2">
          {items.map((c) => (
            <ConnectionRow
              key={c.id}
              connection={c}
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
        </section>
      )}

      {!isPending && !hasAny && (
        <EmptyState
          palette="forest"
          className="mb-10"
          title="Wire up your first connection"
          description={
            <>
              Connections are the services and credentials your agents can reach
              — GitHub for code, Google Workspace for docs, MCP servers for live
              tools, or any custom OAuth or token-based API. Credentials are
              injected into outbound requests at the gateway, so the agent
              runtime never sees raw values.
            </>
          }
          bullets={[
            <>
              <span className="font-semibold">OAuth apps</span> — GitHub, Slack,
              Google Workspace and more. One-click sign-in.
            </>,
            <>
              <span className="font-semibold">MCP servers</span> — remote tool
              servers that expose live capabilities to the agent during a
              session.
            </>,
            <>
              <span className="font-semibold">Custom credentials</span> — bearer
              tokens or API keys injected on a host pattern for any API not on
              the OAuth list.
            </>,
          ]}
          action={
            <Button onClick={() => setChooserOpen(true)}>
              <Plus /> Add Connection
            </Button>
          }
        />
      )}

      <ConnectionChooserDialog
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        templates={visibleTemplates}
        onPick={(t) => {
          setChooserOpen(false);
          setCreating(t);
        }}
      />

      {creating && (
        <TemplateCreateForm
          template={creating}
          onCreated={() => setCreating(null)}
          onCancel={() => setCreating(null)}
        />
      )}
    </div>
  );
}
