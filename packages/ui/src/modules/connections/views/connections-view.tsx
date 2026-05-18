import { Add as Plus } from "@carbon/icons-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { isCustomSecret, type SecretView } from "../../../types.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { EditSecretDialog } from "../../secrets/components/edit-secret-dialog.js";
import { CreateSecretForm } from "../../secrets/forms/create-secret-form.js";
import type { OAuthAppDescriptor } from "../api/fetchers.js";
import {
  useMcpConnections,
  useOAuthAppConnections,
  useOAuthApps,
} from "../api/queries.js";
import { ConnectionChooserDialog } from "../components/connection-chooser-dialog.js";
import { McpConnectionRow } from "../components/mcp-connection-row.js";
import { OAuthAppConnectButton } from "../components/oauth-app-connect-button.js";
import { OAuthAppRow } from "../components/oauth-app-row.js";
import { SecretRow } from "../components/secret-row.js";
import { AddMcpForm } from "../forms/add-mcp-form.js";
import { ConnectAppForm } from "../forms/connect-app-form.js";

export function ConnectionsView() {
  const {
    data: secrets = [],
    isPending: isPendingSecrets,
  } = useSecrets();
  const {
    data: mcpConnections = [],
    isPending: isPendingMcpConnections,
  } = useMcpConnections();
  const {
    data: oauthApps = [],
    isPending: isPendingOAuthApps,
  } = useOAuthApps();
  const {
    data: oauthAppConnections = [],
  } = useOAuthAppConnections();

  const [addMcpInitialUrl, setAddMcpInitialUrl] = useState("");
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [showAddSecret, setShowAddSecret] = useState(false);
  const [editingSecret, setEditingSecret] = useState<SecretView | null>(null);
  const [connectingApp, setConnectingApp] = useState<OAuthAppDescriptor | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  // Tracks whether the currently-open form was launched from the chooser
  // dialog. When true, the form gets a "Back" button that returns to the
  // chooser instead of fully cancelling.
  const [fromChooser, setFromChooser] = useState(false);

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

  const openAddMcp = (initialUrl = "") => {
    setAddMcpInitialUrl(initialUrl);
    setShowAddMcp(true);
  };

  const isAnythingPending =
    isPendingOAuthApps || isPendingMcpConnections || isPendingSecrets;
  const hasAnyConnection =
    oauthAppConnections.length > 0 ||
    mcpConnections.length > 0 ||
    customSecrets.length > 0;

  return (
    <div className="w-full max-w-2xl">
      <div id="tour-connections-header" className="flex items-center gap-3 mb-4">
        <h1 className="text-[20px] md:text-[24px] font-bold text-foreground">Connections</h1>
        {/* Header CTA only shows once there's at least one connection. On
            the empty state, the EmptyState card carries the primary CTA. */}
        {hasAnyConnection && (
          <div className="ml-auto">
            <Button onClick={() => setChooserOpen(true)}>
              <Plus />
              <span className="hidden sm:inline">Add</span> Connection
            </Button>
          </div>
        )}
      </div>

      <p className="text-[14px] text-foreground/80 mb-8 leading-relaxed">
        External services and credentials available to your agents. Injected into outbound HTTP requests — agents never see raw tokens.
      </p>

      {!isAnythingPending && !hasAnyConnection && (
        <EmptyState
          palette="forest"
          className="mb-10"
          eyebrow="Connections"
          title="Wire up your first tool"
          description={
            <>
              Connections are the services and credentials your agent can
              reach — GitHub for code, Google Workspace for docs, MCP servers
              for live tools, or any custom OAuth or secret you've got.
              Credentials are injected into outbound HTTP requests at the
              gateway, so the agent runtime never sees raw tokens.
            </>
          }
          bullets={[
            {
              icon: <span className="text-[10px] font-bold">A</span>,
              text: (
                <>
                  <span className="font-semibold">OAuth apps</span> — GitHub,
                  Slack, Google Workspace, and more. One-click sign-in.
                </>
              ),
            },
            {
              icon: <span className="text-[10px] font-bold">M</span>,
              text: (
                <>
                  <span className="font-semibold">MCP servers</span> — remote
                  tool servers that expose live capabilities to the agent
                  during a session.
                </>
              ),
            },
            {
              icon: <span className="text-[10px] font-bold">S</span>,
              text: (
                <>
                  <span className="font-semibold">Custom secrets</span> —
                  bearer tokens injected on a host/path pattern for any API
                  not on the OAuth list.
                </>
              ),
            },
          ]}
          action={
            <Button onClick={() => setChooserOpen(true)}>
              <Plus /> Add Connection
            </Button>
          }
        />
      )}

      {/* Apps */}
      {(hasAnyConnection || isPendingOAuthApps) && (
        <section className="mb-10">
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em] mb-2">
            Apps
          </h2>
          <p className="text-[12px] text-muted-foreground mb-4">
            OAuth apps like GitHub. Connect them here to grant agents API access on your behalf.
          </p>

          {isPendingOAuthApps && <ListSkeleton />}

          {!isPendingOAuthApps && oauthAppConnections.length === 0 && availableToConnect.length === 0 && (
            <Card className="px-6 py-8 text-center text-[14px] text-muted-foreground anim-in">
              No OAuth apps available.
            </Card>
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
        </section>
      )}

      {/* MCP Servers */}
      {(hasAnyConnection || isPendingMcpConnections) && (
        <section className="mb-10">
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em] mb-2">
            MCP Servers
          </h2>
          <p className="text-[12px] text-muted-foreground mb-4">
            Remote tool servers connected via OAuth. They provide tools your agents can use during sessions.
          </p>

          {isPendingMcpConnections && (
            <ListSkeleton />
          )}

          {!isPendingMcpConnections && mcpConnections.length === 0 && !showAddMcp && (
            <Card className="px-6 py-8 text-center text-[14px] text-muted-foreground anim-in">
              No MCP servers connected yet
            </Card>
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
              <Button onClick={() => openAddMcp()}>
                <Plus size={14} /> Connect MCP Server
              </Button>
            </div>
          )}
        </section>
      )}

      {/* Secrets */}
      {(hasAnyConnection || isPendingSecrets) && (
        <section>
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em] mb-2">
            Secrets
          </h2>
          <p className="text-[12px] text-muted-foreground mb-4">
            Custom bearer tokens injected into outbound requests matching a host pattern.
          </p>

          {isPendingSecrets && (
            <ListSkeleton />
          )}

          {!isPendingSecrets && customSecrets.length === 0 && !showAddSecret && (
            <Card className="px-6 py-8 text-center text-[14px] text-muted-foreground anim-in">
              No custom secrets yet
            </Card>
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
              <Button onClick={() => setShowAddSecret(true)}>
                <Plus size={14} /> Add Secret
              </Button>
            </div>
          )}
        </section>
      )}

      <ConnectionChooserDialog
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        availableApps={availableToConnect}
        onPickApp={(app) => {
          setChooserOpen(false);
          setFromChooser(true);
          setConnectingApp(app);
        }}
        onPickMcp={() => {
          setChooserOpen(false);
          setFromChooser(true);
          openAddMcp();
        }}
        onPickSecret={() => {
          setChooserOpen(false);
          setFromChooser(true);
          setShowAddSecret(true);
        }}
      />

      {showAddMcp && (
        <AddMcpForm
          initialUrl={addMcpInitialUrl}
          onCancel={() => {
            setShowAddMcp(false);
            setFromChooser(false);
          }}
          onBack={
            fromChooser
              ? () => {
                  setShowAddMcp(false);
                  setFromChooser(false);
                  setChooserOpen(true);
                }
              : undefined
          }
        />
      )}

      {connectingApp && (
        <ConnectAppForm
          app={connectingApp}
          onCancel={() => {
            setConnectingApp(null);
            setFromChooser(false);
          }}
          onBack={
            fromChooser
              ? () => {
                  setConnectingApp(null);
                  setFromChooser(false);
                  setChooserOpen(true);
                }
              : undefined
          }
        />
      )}

      {showAddSecret && (
        <CreateSecretForm
          onCancel={() => {
            setShowAddSecret(false);
            setFromChooser(false);
          }}
          onCreated={() => {
            setShowAddSecret(false);
            setFromChooser(false);
          }}
          onBack={
            fromChooser
              ? () => {
                  setShowAddSecret(false);
                  setFromChooser(false);
                  setChooserOpen(true);
                }
              : undefined
          }
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
