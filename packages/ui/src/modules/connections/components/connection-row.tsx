import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import type {
  ConnectionHolder,
  ConnectionHolders,
} from "../hooks/use-connection-holders.js";
import type {
  RowGrantControls,
  RowMaintenanceActions,
  RowToolAccess,
} from "./catalog-connection-row.js";
import { ConnectionRowCard } from "./connection-row-card.js";

export interface ConnectionRowControls {
  templateById: ReadonlyMap<string, ConnectionTemplateView>;
  bare?: boolean;
  grant?: (connection: ConnectionView) => RowGrantControls | undefined;
  onManage?: () => void;
  onDelete?: (id: string, name: string) => void;
  deletingId?: string | null;
  maintenance?: (
    connection: ConnectionView,
  ) => RowMaintenanceActions | undefined;
  holders?: ConnectionHolders | null;
  toolAccess?: (connection: ConnectionView) => RowToolAccess | undefined;
}

export function usedByOf(
  holders: ConnectionHolders | null | undefined,
  connectionId: string,
): readonly ConnectionHolder[] | undefined {
  return holders ? (holders.get(connectionId) ?? []) : undefined;
}

export function ConnectionRow({
  connection,
  templateById,
  bare = false,
  grant,
  onManage,
  onDelete,
  deletingId = null,
  maintenance,
  holders,
  toolAccess,
}: ConnectionRowControls & { connection: ConnectionView }) {
  return (
    <ConnectionRowCard
      bare={bare}
      connection={connection}
      template={templateById.get(connection.templateId)}
      grant={grant?.(connection)}
      onManage={onManage}
      onDelete={onDelete && (() => onDelete(connection.id, connection.name))}
      deleting={deletingId === connection.id}
      maintenance={maintenance?.(connection)}
      usedBy={usedByOf(holders, connection.id)}
      toolAccess={toolAccess?.(connection)}
    />
  );
}
