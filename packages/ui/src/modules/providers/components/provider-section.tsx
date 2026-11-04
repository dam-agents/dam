import {
  BALANCE_PROVIDER_TYPES,
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  hasKeyCheck,
} from "api-server-api";
import { useState } from "react";

import { Card } from "@/components/ui/card";

import type { ProviderPresetType } from "../../../types.js";
import { useConnectionTemplates } from "../../connections/api/queries.js";
import { useDisconnectConnection } from "../../connections/hooks/use-disconnect-connection.js";
import { useProviderStatus } from "../../provider-status/api/queries.js";
import { AllAgentsSpendBadge } from "../../spend/components/all-agents-provider-limit.js";
import { useRecheckProviderKeys } from "../api/mutations.js";
import { useProviderItems } from "../hooks/use-provider-items.js";
import { useRecheckOnOpen } from "../hooks/use-recheck-on-open.js";
import {
  PROVIDER_ROWS,
  providerEntries,
  type ProviderRowDef,
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
  const { itemsByType, itemsByTemplateId, isPending } = useProviderItems();
  const { data: templates, isPending: templatesPending } =
    useConnectionTemplates();
  const itemsOf = (row: ProviderRowDef) =>
    (row.templateId
      ? itemsByTemplateId.get(row.templateId)
      : itemsByType.get(row.type)) ?? [];
  const configured = (templateId: string) =>
    !!templates?.some((t) => t.id === templateId);
  const rows = PROVIDER_ROWS.filter((row) => {
    if (row.templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID)
      return (
        configured(row.templateId) && (!onConnected || itemsOf(row).length > 0)
      );
    if (row.templateId === "curve-bender")
      return (
        !configured(CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID) ||
        itemsOf(row).length > 0
      );
    return true;
  });
  const entries = rows.flatMap((row) => providerEntries(row, itemsOf(row)));
  const { data: status } = useProviderStatus();
  const degradedTemplate = (templateId: string | undefined) =>
    !!status &&
    (status.damSide !== null ||
      status.outages.some((o) => o.templateId === templateId));
  const { confirmAndDelete, deletingId } = useDisconnectConnection();
  const recheck = useRecheckProviderKeys({ silent: true });
  const loading = isPending || templatesPending;
  const checkable = entries.some(
    ({ item }) => !!item && hasKeyCheck(item.conn.templateId),
  );
  /* UNIT_BOUNDARY_DESCRIPTION: keys are checked again on every visit, so the page offers no button for it. */
  useRecheckOnOpen(() => recheck.mutate(), !loading && checkable);
  const checking = recheck.isPending;
  const [dialog, setDialog] = useState<{
    provider: ProviderPresetType;
    item?: ProviderItem;
  } | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const disconnectProvider = async (item: ProviderItem) => {
    if (deletingId !== null) return;
    if (await confirmAndDelete(item.id, item.conn.name)) setDialog(null);
  };

  const connectedItem = dialog?.item;

  return (
    <>
      <div className="flex flex-col gap-3">
        {loading
          ? entries.map((entry) => (
              <Card key={entry.key} className="overflow-hidden">
                <ProviderRow.Skeleton />
              </Card>
            ))
          : entries.map(({ key, row, item, name }) => {
              const managed =
                row.templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID;
              return (
                <Card key={key} className="overflow-hidden">
                  <ProviderRow
                    type={row.type}
                    templateId={row.templateId}
                    name={name}
                    connected={!!item}
                    degraded={!!item && degradedTemplate(item.conn.templateId)}
                    keyCheck={
                      item && !managed
                        ? (item.conn.keyCheck ?? null)
                        : undefined
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
                </Card>
              );
            })}
      </div>

      {infoOpen && <CurveBenderInfoDialog onClose={() => setInfoOpen(false)} />}

      {dialog && (
        <ProviderConnectDialog
          provider={dialog.provider}
          item={dialog.item}
          onConnected={({ id }) => {
            setDialog(null);
            onConnected?.(id);
          }}
          disconnectPending={deletingId !== null}
          onDisconnect={
            connectedItem && (() => void disconnectProvider(connectedItem))
          }
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
