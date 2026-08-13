import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { useMemo, useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { emitToast } from "@/lib/toast";

import { useAppConnections } from "../api/queries.js";
import { TemplateCreateFormBody } from "../forms/template-create-form-body.js";
import { useCatalogGroups } from "../hooks/use-catalog-groups.js";
import { useConnectionMaintenance } from "../hooks/use-connection-maintenance.js";
import { useDisconnectConnection } from "../hooks/use-disconnect-connection.js";
import {
  CATALOG_TAB_LABEL,
  CATALOG_TAB_ORDER,
  type CatalogProviderGroup,
  type CatalogTab,
  catalogTabCounts,
  templateCreateHeading,
} from "../lib/catalog-providers.js";
import { McpCreatePane } from "./catalog-mcp-create-pane.js";
import { CatalogMethodChooser } from "./catalog-method-chooser.js";
import { CatalogPaneHeader } from "./catalog-pane-header.js";
import {
  CatalogProviderCard,
  type SandboxGrantControls,
} from "./catalog-provider-card.js";
import { ConnectionMaintenanceDialog } from "./connection-update-credential-dialog.js";

const NO_CONNECTIONS: ConnectionView[] = [];
const MCP_PROVIDER_ID = "mcp-server";

type Pane =
  | { kind: "browse" }
  | { kind: "choose"; providerId: string }
  | { kind: "create"; templateId: string; providerId: string }
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
  const connectionsQ = useAppConnections();
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
    else if (group.templates.length > 1)
      setPane({ kind: "choose", providerId });
    else if (group.templates[0])
      setPane({
        kind: "create",
        templateId: group.templates[0].id,
        providerId,
      });
  };

  const onCreated = (id: string) => {
    sandbox?.onToggleGrant(id, true);
    emitToast({
      kind: "success",
      message: sandbox
        ? "Connection added to this sandbox."
        : "Connection created.",
    });
    onClose();
  };

  const groupById = (providerId: string) =>
    allGroups.find((g) => g.provider.id === providerId);
  const backFromCreate = (providerId: string) => {
    const group = groupById(providerId);
    setPane(
      group && group.templates.length > 1
        ? { kind: "choose", providerId }
        : { kind: "browse" },
    );
  };

  if (maintenance.updating || maintenance.editingScope) {
    return <ConnectionMaintenanceDialog maintenance={maintenance} />;
  }

  return (
    <Modal widthClass="w-[860px] max-w-full h-[85vh]">
      <DialogHeader
        title="Connection catalogue"
        subtitle="Manage and create new connections your sandboxes can use"
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
          {pane.kind === "choose" && (
            <ChoosePane
              group={groupById(pane.providerId)}
              onBack={() => setPane({ kind: "browse" })}
              onPick={(t) =>
                setPane({
                  kind: "create",
                  templateId: t.id,
                  providerId: pane.providerId,
                })
              }
            />
          )}
          {pane.kind === "create" && (
            <CreatePane
              template={templateById.get(pane.templateId)}
              oauthReturnView={oauthReturnView}
              onBack={() => backFromCreate(pane.providerId)}
              onCreated={onCreated}
            />
          )}
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

function ChoosePane({
  group,
  onBack,
  onPick,
}: {
  group: CatalogProviderGroup | undefined;
  onBack: () => void;
  onPick: (template: ConnectionTemplateView) => void;
}) {
  if (!group) return null;
  return (
    <>
      <CatalogPaneHeader
        title={`Connect ${group.provider.title}`}
        subtitle="Choose an authentication method"
        onBack={onBack}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <CatalogMethodChooser templates={group.templates} onPick={onPick} />
      </div>
    </>
  );
}

function CreatePane({
  template,
  oauthReturnView,
  onBack,
  onCreated,
}: {
  template: ConnectionTemplateView | undefined;
  oauthReturnView?: string;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  if (!template) return null;
  const { title, subtitle } = templateCreateHeading(template);
  return (
    <>
      <CatalogPaneHeader title={title} subtitle={subtitle} onBack={onBack} />
      <TemplateCreateFormBody
        key={template.id}
        template={template}
        popupOAuth
        oauthReturnView={oauthReturnView}
        onCreated={onCreated}
        onCancel={onBack}
        layout={(fields, footer) => (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-5">{fields}</div>
            <div className="flex justify-end gap-3 border-t border-border px-5 py-4">
              {footer}
            </div>
          </>
        )}
      />
    </>
  );
}
