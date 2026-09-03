import type { ConnectionView } from "api-server-api";
import { useMemo, useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { emitToast } from "@/lib/toast";

import { useAppConnections } from "../api/queries.js";
import { useCatalogGroups } from "../hooks/use-catalog-groups.js";
import { useConnectionMaintenance } from "../hooks/use-connection-maintenance.js";
import { useDisconnectConnection } from "../hooks/use-disconnect-connection.js";
import {
  CATALOG_TAB_LABEL,
  CATALOG_TAB_ORDER,
  type CatalogProviderGroup,
  type CatalogTab,
  catalogTabCounts,
} from "../lib/catalog-providers.js";
import { CatalogCreatePane } from "./catalog-create-pane.js";
import { McpCreatePane } from "./catalog-mcp-create-pane.js";
import {
  CatalogProviderCard,
  type SandboxGrantControls,
} from "./catalog-provider-card.js";
import { ConnectionMaintenanceDialog } from "./connection-update-credential-dialog.js";

const NO_CONNECTIONS: ConnectionView[] = [];
const MCP_PROVIDER_ID = "mcp-server";

type Pane =
  | { kind: "browse" }
  | { kind: "create"; providerId: string }
  | { kind: "create-mcp" };

interface Props {
  onClose: () => void;
  sandbox?: SandboxGrantControls;
  oauthReturnView?: string;
}

export function ConnectionCatalogModal({
  onClose,
  sandbox,
  oauthReturnView,
}: Props) {
  const connectionsQ = useAppConnections({ fresh: true });
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const maintenance = useConnectionMaintenance();
  const [activeTab, setActiveTab] = useState<CatalogTab>("apps");
  const [pane, setPane] = useState<Pane>({ kind: "browse" });

  const { byTab, templateById } = useCatalogGroups(
    connectionsQ.data ?? NO_CONNECTIONS,
  );
  const counts = useMemo(() => catalogTabCounts(byTab), [byTab]);
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
  const allGroups = useMemo(() => [...byTab.values()].flat(), [byTab]);

  const handleDelete = async (id: string, name: string) => {
    if ((await confirmAndDelete(id, name)) && sandbox?.grantedIds.has(id))
      sandbox.onToggleGrant(id, false);
  };

  const openNew = (group: CatalogProviderGroup) => {
    const providerId = group.provider.id;
    if (providerId === MCP_PROVIDER_ID) setPane({ kind: "create-mcp" });
    else if (group.templates.length > 0)
      setPane({ kind: "create", providerId });
  };

  const onCreated = (id: string) => {
    sandbox?.onToggleGrant(id, true);
    emitToast({
      kind: "success",
      message: sandbox
        ? "Connection added to this agent."
        : "Connection created.",
    });
    onClose();
  };

  const groupById = (providerId: string) =>
    allGroups.find((g) => g.provider.id === providerId);

  if (maintenance.updating || maintenance.editingScope) {
    return <ConnectionMaintenanceDialog maintenance={maintenance} />;
  }

  return (
    <Modal widthClass="w-[860px] max-w-full h-[85vh]">
      <DialogHeader
        title="Connection catalogue"
        subtitle="Manage and create new connections your agents can use"
        onClose={onClose}
        closeTestId="catalog-close"
      />
      <div className="flex min-h-0 flex-1">
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
        <div className="flex min-h-0 flex-1 flex-col">
          {pane.kind === "browse" && (
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
              {(byTab.get(activeTab) ?? []).map((group) => (
                <CatalogProviderCard
                  key={group.provider.id}
                  group={group}
                  templateById={templateById}
                  sandbox={sandbox}
                  onNew={() => openNew(group)}
                  onDelete={(id, name) => void handleDelete(id, name)}
                  deletingId={deletingId}
                  maintenance={maintenance.rowActions}
                />
              ))}
            </div>
          )}
          {pane.kind === "create" &&
            (() => {
              const group = groupById(pane.providerId);
              return group ? (
                <CatalogCreatePane
                  group={group}
                  oauthReturnView={oauthReturnView}
                  onBack={() => setPane({ kind: "browse" })}
                  onCreated={onCreated}
                />
              ) : null;
            })()}
          {pane.kind === "create-mcp" && (
            <McpCreatePane
              templateById={templateById}
              oauthReturnView={oauthReturnView}
              onBack={() => setPane({ kind: "browse" })}
              onCreated={onCreated}
            />
          )}
        </div>
      </div>
    </Modal>
  );
}
