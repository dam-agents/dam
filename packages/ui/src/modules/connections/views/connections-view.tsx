import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { isCustomSecret, type SecretView } from "../../../types.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { EditSecretDialog } from "../../secrets/components/edit-secret-dialog.js";
import { CreateSecretForm } from "../../secrets/forms/create-secret-form.js";
import type { OAuthAppDescriptor } from "../api/fetchers.js";
import {
  useAppConnections,
  useMcpConnections,
  useOAuthAppConnections,
  useOAuthApps,
} from "../api/queries.js";
import { AppConnectionRow } from "../components/app-connection-row.js";
import { McpConnectionRow } from "../components/mcp-connection-row.js";
import { OAuthAppConnectButton } from "../components/oauth-app-connect-button.js";
import { OAuthAppRow } from "../components/oauth-app-row.js";
import { SecretRow } from "../components/secret-row.js";
import { AddMcpForm } from "../forms/add-mcp-form.js";
import { ConnectAppForm } from "../forms/connect-app-form.js";

export function ConnectionsView() {
  const {
    data: secrets = [],
    refetch: refetchSecrets,
    isPending: isPendingSecrets,
  } = useSecrets();
  const {
    data: mcpConnections = [],
    refetch: refetchMcpConnections,
    isFetching: isFetchingMcpConnections,
    isPending: isPendingMcpConnections,
  } = useMcpConnections();
  const {
    data: appConnections = [],
    error: appConnectionsError,
    refetch: refetchAppConnections,
    isFetching: isFetchingAppConnections,
    isPending: isPendingAppConnections,
  } = useAppConnections();
  const {
    data: oauthApps = [],
    refetch: refetchOAuthApps,
    isFetching: isFetchingOAuthApps,
    isPending: isPendingOAuthApps,
  } = useOAuthApps();
  const {
    data: oauthAppConnections = [],
    refetch: refetchOAuthAppConnections,
    isFetching: isFetchingOAuthAppConnections,
  } = useOAuthAppConnections();

  const [addMcpInitialUrl, setAddMcpInitialUrl] = useState("");
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [showAddSecret, setShowAddSecret] = useState(false);
  const [editingSecret, setEditingSecret] = useState<SecretView | null>(null);
  const [connectingApp, setConnectingApp] = useState<OAuthAppDescriptor | null>(null);

  const customSecrets = secrets.filter(isCustomSecret);
  const appsById = new Map(oauthApps.map((a) => [a.id, a]));
  const singleAppsConnected = new Set(
    oauthAppConnections
      .map((c) => appsById.get(c.appId))
      .filter((a): a is NonNullable<typeof a> => a != null && a.cardinality === "single")
      .map((a) => a.id),
  );
  const availableToConnect = oauthApps.filter(
    (app) => app.cardinality === "multiple" || !singleAppsConnected.has(app.id),
  );

  const refreshAll = () => {
    refetchAppConnections();
    refetchMcpConnections();
    refetchOAuthApps();
    refetchOAuthAppConnections();
    refetchSecrets();
  };
  const isFetching =
    isFetchingAppConnections ||
    isFetchingMcpConnections ||
    isFetchingOAuthApps ||
    isFetchingOAuthAppConnections;

  const openAddMcp = (initialUrl = "") => {
    setAddMcpInitialUrl(initialUrl);
    setShowAddMcp(true);
  };

  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-[20px] md:text-[24px] font-bold text-text">Connections</h1>
        <button
          onClick={refreshAll}
          className="ml-auto h-8 w-8 rounded-lg border-2 border-border bg-surface flex items-center justify-center text-text-secondary hover:text-accent hover:border-accent btn-brutal shadow-brutal-sm"
        >
          <span className={isFetching ? "anim-spin" : ""}>
            <RefreshCw size={13} />
          </span>
        </button>
      </div>

      <p className="text-[14px] text-text-secondary mb-8 leading-relaxed">
        External services and credentials available to your agents. Injected into outbound HTTP requests — agents never see raw tokens.
      </p>

      {/* Apps */}
      <section className="mb-10">
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
          Apps
        </h2>
        <p className="text-[12px] text-text-muted mb-4">
          OAuth apps like GitHub. Connect them here to grant agents API access on your behalf.
        </p>

        {isPendingOAuthApps && <ListSkeleton />}

        {!isPendingOAuthApps && oauthAppConnections.length === 0 && availableToConnect.length === 0 && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
            No OAuth apps available.
          </div>
        )}

        {!isPendingOAuthApps && oauthAppConnections.length > 0 && (
          <div className="flex flex-col gap-3">
            {oauthAppConnections.map((connection, i) => {
              const app = appsById.get(connection.appId);
              if (!app) return null;
              return (
                <OAuthAppRow
                  key={connection.connectionId}
                  app={app}
                  connection={connection}
                  animationDelayMs={i * 50}
                  onReconnect={setConnectingApp}
                />
              );
            })}
          </div>
        )}

        {!isPendingOAuthApps && availableToConnect.length > 0 && (
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-2 ${oauthAppConnections.length > 0 ? "mt-4" : ""}`}>
            {availableToConnect.map((app) => (
              <OAuthAppConnectButton key={app.id} app={app} onConnect={setConnectingApp} />
            ))}
          </div>
        )}

        {/* Legacy OneCLI-managed app connections — read-only until the
            corresponding migration completes. */}
        {!isPendingAppConnections && !appConnectionsError && appConnections.length > 0 && (
          <>
            <div className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mt-6 mb-2">
              Managed in OneCLI
            </div>
            <div className="flex flex-col gap-3">
              {appConnections.map((connection, i) => (
                <AppConnectionRow
                  key={connection.id}
                  connection={connection}
                  animationDelayMs={i * 50}
                />
              ))}
            </div>
          </>
        )}

        {!isPendingAppConnections && appConnectionsError && (
          <div className="rounded-xl border-2 border-danger bg-danger-light px-6 py-4 anim-in mt-4">
            <div className="text-[13px] font-semibold text-danger">
              Couldn't load app connections from OneCLI.
            </div>
            <div className="text-[11px] font-mono text-danger/80 mt-1 break-all">
              {appConnectionsError.message}
            </div>
          </div>
        )}
      </section>

      {/* MCP Servers */}
      <section className="mb-10">
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
          MCP Servers
        </h2>
        <p className="text-[12px] text-text-muted mb-4">
          Remote tool servers connected via OAuth. They provide tools your agents can use during sessions.
        </p>

        {isPendingMcpConnections && (
          <ListSkeleton />
        )}

        {!isPendingMcpConnections && mcpConnections.length === 0 && !showAddMcp && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
            No MCP servers connected yet
          </div>
        )}

        {!isPendingMcpConnections && mcpConnections.length > 0 && (
          <div className="flex flex-col gap-3">
            {mcpConnections.map((connection, i) => (
              <McpConnectionRow
                key={connection.hostname}
                connection={connection}
                animationDelayMs={i * 50}
                onReconnect={(hostname) => openAddMcp(`https://${hostname}/mcp`)}
              />
            ))}
          </div>
        )}

        {!isPendingMcpConnections && (
          <div className="mt-4">
            <button
              onClick={() => openAddMcp()}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-semibold text-white flex items-center gap-1.5 shadow-brutal-accent"
            >
              <Plus size={14} /> Connect MCP Server
            </button>
          </div>
        )}
      </section>

      {/* Secrets */}
      <section>
        <h2 className="text-[11px] font-bold text-text-muted uppercase tracking-[0.05em] mb-2">
          Secrets
        </h2>
        <p className="text-[12px] text-text-muted mb-4">
          Custom bearer tokens injected into outbound requests matching a host pattern.
        </p>

        {isPendingSecrets && (
          <ListSkeleton />
        )}

        {!isPendingSecrets && customSecrets.length === 0 && !showAddSecret && (
          <div className="rounded-xl border-2 border-border-light bg-surface px-6 py-8 text-center text-[14px] text-text-muted anim-in">
            No custom secrets yet
          </div>
        )}

        {!isPendingSecrets && (
          <div className="flex flex-col gap-3">
            {customSecrets.map((secret, i) => (
              <SecretRow
                key={secret.id}
                secret={secret}
                animationDelayMs={i * 50}
                onEdit={setEditingSecret}
              />
            ))}
          </div>
        )}

        {!isPendingSecrets && (
          <div className="mt-4">
            <button
              onClick={() => setShowAddSecret(true)}
              className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-4 text-[13px] font-semibold text-white flex items-center gap-1.5 shadow-brutal-accent"
            >
              <Plus size={14} /> Add Secret
            </button>
          </div>
        )}
      </section>

      {showAddMcp && (
        <AddMcpForm
          initialUrl={addMcpInitialUrl}
          onCancel={() => setShowAddMcp(false)}
        />
      )}

      {connectingApp && (
        <ConnectAppForm app={connectingApp} onCancel={() => setConnectingApp(null)} />
      )}

      {showAddSecret && (
        <CreateSecretForm
          onCancel={() => setShowAddSecret(false)}
          onCreated={() => setShowAddSecret(false)}
        />
      )}

      {editingSecret && (
        <EditSecretDialog
          secret={editingSecret}
          onClose={() => setEditingSecret(null)}
        />
      )}
    </div>
  );
}
