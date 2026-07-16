import { ArrowLeft, Close } from "@carbon/icons-react";
import {
  type ConnectionTemplateView,
  type ConnectionView,
  PROVIDER_TEMPLATE_IDS,
} from "api-server-api";
import { useMemo, useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";
import { emitToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import {
  useAppConnections,
  useConnectionTemplates,
} from "../api/queries.js";
import { TemplateCreateFormBody } from "../forms/template-create-form-body.js";
import { useDisconnectConnection } from "../hooks/use-disconnect-connection.js";
import {
  filterOfferedTemplates,
  isShowInternalConnectionsEnabled,
} from "../internal-only.js";
import {
  CATALOG_TAB_LABEL,
  CATALOG_TAB_ORDER,
  type CatalogProviderGroup,
  type CatalogTab,
  catalogTabCounts,
  groupCatalog,
  templateCreateHeading,
} from "../lib/catalog-providers.js";
import { CatalogMethodChooser } from "./catalog-method-chooser.js";
import {
  CatalogProviderCard,
  type SandboxGrantControls,
} from "./catalog-provider-card.js";

const NO_TEMPLATES: ConnectionTemplateView[] = [];
const NO_CONNECTIONS: ConnectionView[] = [];

type Pane =
  | { kind: "browse" }
  | { kind: "choose"; providerId: string }
  | { kind: "create"; templateId: string; providerId: string };

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
  const [pane, setPane] = useState<Pane>({ kind: "browse" });

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
  const allGroups = useMemo(() => [...byTab.values()].flat(), [byTab]);

  // Deleting a granted connection also drops its grant (#2426).
  const handleDelete = async (id: string, name: string) => {
    if ((await confirmAndDelete(id, name)) && sandbox?.grantedIds.has(id))
      sandbox.onToggleGrant(id, false);
  };

  const openNew = (group: CatalogProviderGroup) => {
    const providerId = group.provider.id;
    if (group.templates.length > 1) setPane({ kind: "choose", providerId });
    else if (group.templates[0])
      setPane({ kind: "create", templateId: group.templates[0].id, providerId });
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
              onClick={() => {
                setActiveTab(tab);
                setPane({ kind: "browse" });
              }}
              data-testid={`catalog-tab-${tab}`}
              className={cn(
                "flex h-[44px] items-center justify-between rounded-lg px-4 text-[14px]",
                tab === activeTab && pane.kind === "browse"
                  ? "bg-muted font-semibold text-foreground"
                  : "text-foreground hover:bg-muted/60",
              )}
            >
              {CATALOG_TAB_LABEL[tab]}
              <span className="text-muted-foreground">{counts[tab]}</span>
            </button>
          ))}
        </nav>
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
              onCreated={(id) => {
                sandbox?.onToggleGrant(id, true);
                emitToast({
                  kind: "success",
                  message: sandbox
                    ? "Connection added to this sandbox."
                    : "Connection created.",
                });
                onClose();
              }}
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
      <PaneHeader
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
      <PaneHeader title={title} subtitle={subtitle} onBack={onBack} />
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
            <div className="flex justify-end gap-3 border-t border-border-light px-5 py-4">
              {footer}
            </div>
          </>
        )}
      />
    </>
  );
}

function PaneHeader({
  title,
  subtitle,
  onBack,
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border-light px-5 py-4">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        data-testid="catalog-back"
        className="text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft size={18} />
      </button>
      <div>
        <h3 className="text-[15px] font-semibold text-foreground">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 text-[14px] text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
