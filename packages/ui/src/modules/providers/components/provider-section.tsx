import {
  BALANCE_PROVIDER_TYPES,
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  harnessFits,
  hasKeyCheck,
} from "api-server-api";
import { useState } from "react";

import { Card } from "@/components/ui/card";

import { useStore } from "../../../store.js";
import type { ProviderPresetType } from "../../../types.js";
import { useDeleteConnection } from "../../connections/api/mutations.js";
import { useConnectionTemplates } from "../../connections/api/queries.js";
import { useProviderStatus } from "../../provider-status/api/queries.js";
import { useHarnessCatalog } from "../../sessions/api/session-pair.js";
import { AllAgentsSpendBadge } from "../../spend/components/all-agents-provider-limit.js";
import { useRecheckProviderKeys } from "../api/mutations.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import { useRecheckOnOpen } from "../hooks/use-recheck-on-open.js";
import {
  PROVIDER_ROWS,
  type ProviderRowDef,
  providerRowName,
} from "../lib/provider-rows.js";
import { CurveBenderInfoDialog } from "./curve-bender-info-dialog.js";
import { ProviderBalance } from "./provider-balance.js";
import { ProviderConnectDialog } from "./provider-connect-dialog.js";
import type { ProviderItem } from "./provider-item.js";
import { ProviderRow } from "./provider-row.js";

export function ProviderSection({
  onConnected,
}: {
  onConnected?: (connectionId: string) => void;
} = {}) {
  const { itemByType, itemByTemplateId, isPending } = useProviderItems();
  const { data: catalog, isPending: catalogPending } = useHarnessCatalog();
  const { data: templates, isPending: templatesPending } =
    useConnectionTemplates();
  const itemOf = (row: ProviderRowDef) =>
    row.templateId
      ? itemByTemplateId.get(row.templateId)
      : itemByType.get(row.type);
  const configured = (templateId: string) =>
    !!templates?.some((t) => t.id === templateId);
  const rows = PROVIDER_ROWS.filter((row) => {
    const item = itemOf(row);
    if (row.templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID)
      return configured(row.templateId) && (!onConnected || item !== undefined);
    return true;
  });
  const { data: status } = useProviderStatus();
  const degradedTemplate = (templateId: string | undefined) =>
    !!status &&
    (status.damSide !== null ||
      status.outages.some((o) => o.templateId === templateId));
  const showConfirm = useStore((s) => s.showConfirm);
  const deleteConnection = useDeleteConnection();
  const recheck = useRecheckProviderKeys({ silent: true });
  const loading = isPending || catalogPending || templatesPending;
  const checkable = rows.some((row) => {
    const item = itemOf(row);
    return !!item && hasKeyCheck(item.conn.templateId);
  });
  /* UNIT_BOUNDARY_DESCRIPTION: keys are checked again on every visit, so the page offers no button for it. */
  useRecheckOnOpen(() => recheck.mutate(), !loading && checkable);
  const checking = recheck.isPending;
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    item?: ProviderItem;
  } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const disconnectProvider = async (item: ProviderItem) => {
    const ok = await showConfirm(
      "Agents using this provider can no longer reach its models.",
      "Disconnect provider?",
      { kind: "destructive", confirmLabel: "Disconnect provider" },
    );
    if (!ok) return;
    deleteConnection.mutate({ id: item.id });
    setDialog(null);
  };

  const connectedItem = dialog?.item;

  return (
    <>
      <Card className="divide-y divide-border overflow-hidden">
        {loading
          ? rows.map((row) => (
              <ProviderRow.Skeleton
                key={`${row.type}:${row.templateId ?? ""}`}
              />
            ))
          : rows.map((row) => {
              const item = itemOf(row);
              const managed =
                row.templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID;
              return (
                <ProviderRow
                  key={`${row.type}:${row.templateId ?? ""}`}
                  type={row.type}
                  templateId={row.templateId}
                  name={providerRowName(row)}
                  harnesses={catalog?.harnesses
                    .filter((h) =>
                      harnessFits(
                        catalog,
                        h.name,
                        row.type,
                        item?.conn.templateId,
                      ),
                    )
                    .map((h) => h.name)}
                  connected={!!item}
                  degraded={!!item && degradedTemplate(item.conn.templateId)}
                  keyCheck={
                    item && !managed ? (item.conn.keyCheck ?? null) : undefined
                  }
                  checking={
                    checking && !!item && hasKeyCheck(item.conn.templateId)
                  }
                  balance={
                    item &&
                    !managed &&
                    BALANCE_PROVIDER_TYPES.has(row.type) && (
                      <ProviderBalance connectionId={item.id} />
                    )
                  }
                  spend={
                    item &&
                    !onConnected && (
                      <AllAgentsSpendBadge
                        connectionId={item.id}
                        connectionName={item.conn.name}
                        templateId={item.conn.templateId}
                      />
                    )
                  }
                  connectedAction={
                    item && managed && !onConnected
                      ? "About"
                      : onConnected && "Use"
                  }
                  onOpen={
                    managed
                      ? item &&
                        (onConnected
                          ? () => onConnected(item.id)
                          : () => setInfoOpen(true))
                      : () =>
                          item && onConnected
                            ? onConnected(item.id)
                            : setDialog({ provider: row.type, item })
                  }
                />
              );
            })}
      </Card>

      {infoOpen && <CurveBenderInfoDialog onClose={() => setInfoOpen(false)} />}

      {dialog && (
        <ProviderConnectDialog
          provider={dialog.provider}
          item={dialog.item}
          onConnected={({ id }) => {
            setDialog(null);
            onConnected?.(id);
          }}
          onDisconnect={
            connectedItem && (() => void disconnectProvider(connectedItem))
          }
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
