import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import { connectionKindSubtitle } from "../lib/catalog-providers.js";
import type {
  RowGrantControls,
  RowMaintenanceActions,
} from "./catalog-connection-row.js";
import { CatalogConnectionRow } from "./catalog-connection-row.js";

interface Props {
  connection: ConnectionView;
  template: ConnectionTemplateView | undefined;
  grant?: RowGrantControls;
  onManage?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  maintenance?: RowMaintenanceActions;
  onRemove?: () => void;
  onNewChild?: () => void;
  bare?: boolean;
}

export function ConnectionRowCard({
  connection,
  template,
  grant,
  onManage,
  onDelete,
  deleting,
  maintenance,
  onRemove,
  onNewChild,
  bare = false,
}: Props) {
  return (
    <div className={bare ? undefined : "rounded-lg border border-border"}>
      <CatalogConnectionRow
        connection={connection}
        tag={connectionKindSubtitle(connection, template)}
        iconSlug={template?.iconSlug}
        grant={grant}
        onManage={onManage}
        onDelete={onDelete}
        deleting={deleting}
        maintenance={maintenance}
        onRemove={onRemove}
        onNewChild={onNewChild}
      />
    </div>
  );
}
