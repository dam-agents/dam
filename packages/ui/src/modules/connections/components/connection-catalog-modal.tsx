import { Close } from "@carbon/icons-react";
import {
  type ConnectionTemplateView,
  type ConnectionView,
  PROVIDER_TEMPLATE_IDS,
} from "api-server-api";
import { useMemo, useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";
import { cn } from "@/lib/utils";

import {
  useAppConnections,
  useConnectionTemplates,
} from "../api/queries.js";
import { TemplateCreateForm } from "../forms/template-create-form.js";
import { useDisconnectConnection } from "../hooks/use-disconnect-connection.js";
import {
  filterOfferedTemplates,
  isShowInternalConnectionsEnabled,
} from "../internal-only.js";
import {
  CATALOG_TAB_LABEL,
  CATALOG_TAB_ORDER,
  type CatalogTab,
  catalogTabCounts,
  groupCatalog,
} from "../lib/catalog-providers.js";
import {
  CatalogProviderCard,
  type SandboxGrantControls,
} from "./catalog-provider-card.js";

const NO_TEMPLATES: ConnectionTemplateView[] = [];
const NO_CONNECTIONS: ConnectionView[] = [];

interface Props {
  onClose: () => void;
  /** Grant controls of the hosting sandbox; omit for the global catalogue. */
  sandbox?: SandboxGrantControls;
  oauthReturnView?: string;
}

export function ConnectionCatalogModal({
  onClose,
  sandbox,
  oauthReturnView,
}: Props) {
  const templatesQ = useConnectionTemplates();
  const connectionsQ = useAppConnections();
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const [activeTab, setActiveTab] = useState<CatalogTab>("apps");
  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);

  const allTemplates = templatesQ.data ?? NO_TEMPLATES;
  const connections = connectionsQ.data ?? NO_CONNECTIONS;

  const showInternal = isShowInternalConnectionsEnabled();
  const byTab = useMemo(
    () =>
      groupCatalog({
        offeredTemplates: filterOfferedTemplates(
          allTemplates,
          showInternal,
        ).filter((t) => !PROVIDER_TEMPLATE_IDS.has(t.id)),
        allTemplates,
        connections: connections.filter(
          (c) => !PROVIDER_TEMPLATE_IDS.has(c.templateId),
        ),
      }),
    [allTemplates, connections, showInternal],
  );
  const counts = useMemo(() => catalogTabCounts(byTab), [byTab]);
  const templateById = useMemo(
    () => new Map(allTemplates.map((t) => [t.id, t])),
    [allTemplates],
  );

  // Deleting a granted connection also drops its grant (#2426).
  const handleDelete = async (id: string, name: string) => {
    if ((await confirmAndDelete(id, name)) && sandbox?.grantedIds.has(id))
      sandbox.onToggleGrant(id, false);
  };

  return (
    <Modal widthClass="w-[860px] max-w-full h-[85vh]">
      <DialogHeader className="flex items-start justify-between gap-4 border-b">
        <div>
          <h2 className="text-[18px] font-semibold text-foreground">
            Connection catalogue
          </h2>
          <p className="mt-1 text-[14px] text-muted-foreground">
            Manage and create new connections your sandboxes can use
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          data-testid="catalog-close"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <Close size={20} />
        </button>
      </DialogHeader>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[200px] shrink-0 flex-col gap-1 border-r border-border-light p-3">
          {CATALOG_TAB_ORDER.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              data-testid={`catalog-tab-${tab}`}
              className={cn(
                "flex h-[44px] items-center justify-between rounded-lg px-4 text-[14px]",
                tab === activeTab
                  ? "bg-muted font-semibold text-foreground"
                  : "text-foreground hover:bg-muted/60",
              )}
            >
              {CATALOG_TAB_LABEL[tab]}
              <span className="text-muted-foreground">{counts[tab]}</span>
            </button>
          ))}
        </nav>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          {(byTab.get(activeTab) ?? []).map((group) => (
            <CatalogProviderCard
              key={group.provider.id}
              group={group}
              templateById={templateById}
              sandbox={sandbox}
              onCreate={setCreating}
              onDelete={(id, name) => void handleDelete(id, name)}
              deletingId={deletingId}
            />
          ))}
        </div>
      </div>
      {creating && (
        <TemplateCreateForm
          template={creating}
          popupOAuth
          oauthReturnView={oauthReturnView}
          onCreated={(id) => {
            setCreating(null);
            sandbox?.onToggleGrant(id, true);
          }}
          onCancel={() => setCreating(null)}
        />
      )}
    </Modal>
  );
}
