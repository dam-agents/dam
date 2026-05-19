import { Add as Plus } from "@carbon/icons-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

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
  // Forms launched from the chooser get a Back button that returns to
  // the chooser; forms launched some other way (e.g. an OAuth app
  // re-connect) just close on cancel.
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

  const openChooser = () => {
    setFromChooser(false);
    setChooserOpen(true);
  };

  const isAnythingPending =
    isPendingOAuthApps || isPendingMcpConnections || isPendingSecrets;
  const hasAnyConnection =
    oauthAppConnections.length > 0 ||
    mcpConnections.length > 0 ||
    customSecrets.length > 0;

  return (
    <div className="w-full max-w-2xl">
      {/* Header + description only render once at least one connection
          exists. On the empty state the EmptyState card's own title
          carries the page heading. */}
      {hasAnyConnection && (
        <>
          <div id="tour-connections-header" className="flex items-center gap-3 mb-4">
            <h1 className="text-[20px] md:text-[24px] font-bold text-foreground">Connections</h1>
            <div className="ml-auto">
              <Button onClick={openChooser}>
                <Plus />
                <span className="hidden sm:inline">Add</span> Connection
              </Button>
            </div>
          </div>

          <p className="text-[14px] text-foreground/80 mb-8 leading-relaxed">
            External services and credentials available to your agents. Injected into outbound HTTP requests — agents never see raw tokens.
          </p>
        </>
      )}

      {!isAnythingPending && !hasAnyConnection && (
        <EmptyState
          palette="forest"
          title="Set up a connection"
          description={
            <>
              Connections are the services and credentials your agent can
              reach. Add one — credentials are injected at the gateway, so
              the agent never sees raw tokens.
            </>
          }
          bullets={[
            <>
              <span className="font-semibold">OAuth apps</span> — GitHub,
              Slack, Google Workspace, and more. One-click sign-in.
            </>,
            <>
              <span className="font-semibold">MCP servers</span> — remote tool
              servers that expose live capabilities to the agent during a
              session.
            </>,
            <>
              <span className="font-semibold">Custom secrets</span> — bearer
              tokens injected on a host/path pattern for any API not on the
              OAuth list.
            </>,
          ]}
          action={
            <Button onClick={openChooser}>
              <Plus /> Add Connection
            </Button>
          }
        />
      )}

      {oauthAppConnections.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em] mb-2">
            Apps
          </h2>
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
        </section>
      )}

      {mcpConnections.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em] mb-2">
            MCP Servers
          </h2>
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
        </section>
      )}

      {customSecrets.length > 0 && (
        <section className="mb-8">
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em] mb-2">
            Secrets
          </h2>
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
        </section>
      )}

      {isAnythingPending && !hasAnyConnection && (
        <section className="mb-8">
          <ListSkeleton />
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
