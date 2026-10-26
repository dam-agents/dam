import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import type {
  RowGrantControls,
  RowMaintenanceActions,
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
    />
  );
}
