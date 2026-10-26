import type { ConnectionView, SatelliteView } from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { emitToast } from "@/lib/toast";

import { NO_SATELLITES, useSatellites } from "../../satellites/api/queries.js";
import { CatalogSatellitesPane } from "../../satellites/components/catalog-satellites-pane.js";
import { fetchConnection, useAppConnections } from "../api/queries.js";
import { useCatalogGroups } from "../hooks/use-catalog-groups.js";
import { useConnectionMaintenance } from "../hooks/use-connection-maintenance.js";
import { useDisconnectConnection } from "../hooks/use-disconnect-connection.js";
import {
  CATALOG_TAB_LABEL,
  CATALOG_TAB_ORDER,
  type CatalogProviderGroup,
  type CatalogTab,
  catalogTabCounts,
  filterGroupsByAccepts,
} from "../lib/catalog-providers.js";
import type { ConnectionAudience } from "../lib/connection-audience.js";
import { childrenOf } from "../lib/connection-hierarchy.js";
import type { NamedConnection } from "../lib/connection-label.js";
import {
  grantBlockedReason,
  grantRivalry,
  grantSkippedMessage,
} from "../lib/grant-rivals.js";
import type { RowGrantControls } from "./catalog-connection-row.js";
import { CatalogCreateChildPane } from "./catalog-create-child-pane.js";
import { CatalogCreatePane } from "./catalog-create-pane.js";
import { McpCreatePane } from "./catalog-mcp-create-pane.js";
import {
  CatalogProviderCard,
  type SandboxGrantControls,
} from "./catalog-provider-card.js";
import { ConnectionAudienceNotice } from "./connection-audience-notice.js";
import { ConnectionAudienceSentence } from "./connection-audience-sentence.js";
import { ConnectionMaintenanceDialog } from "./connection-update-credential-dialog.js";

const NO_CONNECTIONS: ConnectionView[] = [];
const MCP_PROVIDER_ID = "mcp-server";

type Pane =
  | { kind: "browse" }
  | { kind: "create"; providerId: string }
  | { kind: "create-mcp" }
  | { kind: "create-child"; parent: ConnectionView };

export interface ConnectionSharing {
  notice: ConnectionAudience | null;
  confirm: (connection?: NamedConnection) => Promise<boolean>;
}

interface Props {
  onClose: () => void;
  sandbox?: SandboxGrantControls;
  sharing?: ConnectionSharing;
  satelliteGrant?: (satellite: SatelliteView) => RowGrantControls;
  oauthReturnView?: string;
  onGoToChannels?: () => void;
  initialProviderId?: string;
  initialTemplateId?: string;
  accepts?: readonly string[];
  title?: string;
  subtitle?: string;
  singlePage?: boolean;
}

export function ConnectionCatalogModal({
  onClose,
  sandbox,
  sharing,
  satelliteGrant,
  oauthReturnView,
  onGoToChannels,
  initialProviderId,
  initialTemplateId,
  accepts,
  title,
  subtitle,
  singlePage = false,
}: Props) {
  const connectionsQ = useAppConnections({ fresh: true });
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const maintenance = useConnectionMaintenance();
  const [activeTab, setActiveTab] = useState<CatalogTab>("apps");
  const { data: satellites = NO_SATELLITES } = useSatellites({ live: true });
  const showSatellites =
    satellites.length > 0 && (!sandbox || satelliteGrant !== undefined);
  const [pane, setPane] = useState<Pane>({ kind: "browse" });
  const createShareConfirmed = useRef(false);

  const {
    byTab,
    templateById,
    loading: loadingCatalog,
  } = useCatalogGroups(connectionsQ.data ?? NO_CONNECTIONS);
  const counts = useMemo(() => {
    const base = catalogTabCounts(byTab);
    return showSatellites
      ? { ...base, mcp: base.mcp + satellites.length }
      : base;
  }, [byTab, showSatellites, satellites.length]);
  const catalogTabs = useMemo<TabDef<CatalogTab>[]>(
    () =>
      CATALOG_TAB_ORDER.map((tab) => ({
        value: tab,
        label: CATALOG_TAB_LABEL[tab],
        trailing: <span className="text-muted-foreground">{counts[tab]}</span>,
        testId: `catalog-tab-${tab}`,
      })),
    [counts],
  );
  const grantedIds = sandbox?.grantedIds;
  const grantedConnections = useMemo(
    () =>
      grantedIds
        ? (connectionsQ.data ?? NO_CONNECTIONS).filter((c) =>
            grantedIds.has(c.id),
          )
        : NO_CONNECTIONS,
    [connectionsQ.data, grantedIds],
  );
  const blockedReasonOf = (connection: ConnectionView) => {
    const rivalry = grantRivalry(connection, grantedConnections);
    return rivalry && grantBlockedReason(rivalry);
  };
  const allGroups = useMemo(() => [...byTab.values()].flat(), [byTab]);
  const narrowed = useMemo(
    () => (accepts ? filterGroupsByAccepts(allGroups, accepts) : null),
    [allGroups, accepts],
  );

  const openedInitial = useRef(false);
  useEffect(() => {
    if (openedInitial.current || (!initialProviderId && !initialTemplateId))
      return;
    const group = allGroups.find(
      (g) =>
        g.provider.id === initialProviderId ||
        g.templates.some((t) => t.id === initialTemplateId),
    );
    if (!group) return;
    openedInitial.current = true;
    setPane(
      group.provider.id === MCP_PROVIDER_ID
        ? { kind: "create-mcp" }
        : { kind: "create", providerId: group.provider.id },
    );
  }, [allGroups, initialProviderId, initialTemplateId]);

  const handleDelete = async (id: string, name: string) => {
    const children = childrenOf(id, connectionsQ.data ?? NO_CONNECTIONS);
    if (!(await confirmAndDelete(id, name)) || !sandbox) return;
    const revoked = [id, ...children.map((c) => c.id)].filter((deleted) =>
      sandbox.grantedIds.has(deleted),
    );
    if (revoked.length > 0) sandbox.onRevoke(revoked);
  };

  const confirmShare = async (connection?: NamedConnection) =>
    !sharing || (await sharing.confirm(connection));

  const openNew = async (group: CatalogProviderGroup) => {
    const providerId = group.provider.id;
    const isMcp = providerId === MCP_PROVIDER_ID;
    if (!isMcp && group.templates.length === 0) return;
    if (!(await confirmShare({ name: group.provider.title }))) return;
    createShareConfirmed.current = true;
    setPane(isMcp ? { kind: "create-mcp" } : { kind: "create", providerId });
  };

  const grantSandbox = sandbox && {
    ...sandbox,
    onToggleGrant: (id: string, on: boolean) =>
      void (async () => {
        const connection = connectionsQ.data?.find((c) => c.id === id);
        if (on && !(await confirmShare(connection))) return;
        sandbox.onToggleGrant(id, on);
      })(),
  };

  const grantSatellite =
    satelliteGrant &&
    ((satellite: SatelliteView): RowGrantControls => {
      const controls = satelliteGrant(satellite);
      return {
        ...controls,
        onToggle: (on) =>
          void (async () => {
            if (on && !(await confirmShare(satellite))) return;
            controls.onToggle(on);
          })(),
      };
    });

  const grantCreated = async (id: string) => {
    const created = sandbox && (await fetchConnection(id).catch(() => null));
    if (
      sandbox &&
      !createShareConfirmed.current &&
      !(await confirmShare(created ?? undefined))
    ) {
      emitToast({ kind: "success", message: "Connection created." });
      onClose();
      return;
    }
    if (sandbox) {
      const rivalry = created && grantRivalry(created, grantedConnections);
      if (rivalry) {
        emitToast({ kind: "warning", message: grantSkippedMessage(rivalry) });
        onClose();
        return;
      }
      sandbox.onToggleGrant(id, true);
    }
    emitToast({
      kind: "success",
      message: sandbox
        ? "Connection added to this agent."
        : "Connection created.",
    });
    onClose();
  };
  const onCreated = (id: string) => void grantCreated(id);

  const groupById = (providerId: string) =>
    (narrowed ?? allGroups).find((g) => g.provider.id === providerId);

  if (maintenance.updating || maintenance.editingScope) {
    return <ConnectionMaintenanceDialog maintenance={maintenance} />;
  }

  const createGroup =
    pane.kind === "create" ? groupById(pane.providerId) : undefined;
  // UNIT_BOUNDARY_DESCRIPTION: a create pane takes the whole body while it is open — it brings its own heading, its own scrolling and its own Cancel — and Back or Cancel brings the list back; one page only spares the reader the category rail.
  const createPane =
    pane.kind === "create" ? (
      createGroup ? (
        <CatalogCreatePane
          group={createGroup}
          oauthReturnView={oauthReturnView}
          initialTemplateId={initialTemplateId}
          onBack={() => setPane({ kind: "browse" })}
          onCreated={onCreated}
          onSignedIn={(parent) => setPane({ kind: "create-child", parent })}
        />
      ) : null
    ) : pane.kind === "create-child" ? (
      <CatalogCreateChildPane
        parent={pane.parent}
        onBack={() => setPane({ kind: "browse" })}
        onCreated={onCreated}
      />
    ) : pane.kind === "create-mcp" ? (
      <McpCreatePane
        templateById={templateById}
        oauthReturnView={oauthReturnView}
        onBack={() => setPane({ kind: "browse" })}
        onCreated={onCreated}
      />
    ) : null;

  return (
    <Modal onClose={onClose} size="lg" heightClass="h-[85vh]">
      <DialogHeader
        title={title ?? "Connection catalog"}
        subtitle={
          subtitle ?? "Manage and create new connections your agents can use."
        }
        onClose={onClose}
        closeTestId="catalog-close"
      />
      <div className="flex min-h-0 flex-1">
        {!narrowed && !singlePage && (
          <Tabs
            ariaLabel="Connection categories"
            tabs={catalogTabs}
            value={pane.kind === "browse" ? activeTab : null}
            onValueChange={(tab) => {
              setActiveTab(tab);
              setPane({ kind: "browse" });
            }}
            variant="pill"
            orientation="vertical"
            className="w-[200px] shrink-0 border-r border-border p-3"
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {pane.kind === "browse" && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
              {sharing?.notice && (
                <ConnectionAudienceNotice>
                  <ConnectionAudienceSentence
                    audience={sharing.notice}
                    uses="the connections you add here"
                  />
                </ConnectionAudienceNotice>
              )}
              {narrowed?.length === 0 && !loadingCatalog && (
                <p className="text-sm text-muted-foreground">
                  Nothing this install offers satisfies this requirement.
                </p>
              )}
              {(
                narrowed ??
                (singlePage ? allGroups : (byTab.get(activeTab) ?? []))
              ).map((group) => (
                <CatalogProviderCard
                  key={group.provider.id}
                  group={group}
                  templateById={templateById}
                  sandbox={grantSandbox}
                  grantBlockedReason={blockedReasonOf}
                  onNew={() => void openNew(group)}
                  onDelete={(id, name) => void handleDelete(id, name)}
                  deletingId={deletingId}
                  maintenance={maintenance.rowActions}
                  onGoToChannels={onGoToChannels}
                  onNewChild={(parent) =>
                    setPane({ kind: "create-child", parent })
                  }
                />
              ))}
              {(singlePage || activeTab === "mcp") &&
                showSatellites &&
                !narrowed && (
                  <CatalogSatellitesPane
                    satellites={satellites}
                    grant={grantSatellite}
                  />
                )}
            </div>
          )}
          {createPane}
        </div>
      </div>
    </Modal>
  );
}
