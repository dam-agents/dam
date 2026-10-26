import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import { ListGroup } from "@/components/ui/list-group";

import type { CatalogProviderGroup } from "../lib/catalog-providers.js";
import type {
  RowGrantControls,
  RowMaintenanceActions,
} from "./catalog-connection-row.js";
import { ConnectionIcon } from "./connection-icon.js";
import { ConnectionRows } from "./connection-rows.js";

interface Props {
  group: CatalogProviderGroup;
  templateById: Map<string, ConnectionTemplateView>;
  showCount?: boolean;
  grant?: (connection: ConnectionView) => RowGrantControls | undefined;
  onManage?: () => void;
  onDelete?: (id: string, name: string) => void;
  deletingId?: string | null;
  flat?: boolean;
  maintenance?: (
    connection: ConnectionView,
  ) => RowMaintenanceActions | undefined;
  onNewChild?: (parent: ConnectionView) => void;
}

export function ConnectionGroup({
  group,
  templateById,
  showCount = false,
  grant,
  onManage,
  onDelete,
  deletingId = null,
  flat = false,
  maintenance,
  onNewChild,
}: Props) {
  const { provider, connections } = group;
  const rows = (
    <ConnectionRows
      bare
      connections={connections}
      templateById={templateById}
      grant={grant}
      onManage={onManage}
      onDelete={onDelete}
      deletingId={deletingId}
      maintenance={maintenance}
      onNewChild={onNewChild}
    />
  );
  // UNIT_BOUNDARY_DESCRIPTION: the Services panel lists every connection in one run, so a group draws no header there and its rows join the others under the one card.
  if (flat) return <>{rows}</>;
  return (
    <ListGroup
      testId={`connection-group-${provider.id}`}
      title={provider.title}
      icon={
        <ConnectionIcon
          iconSlug={provider.iconSlug}
          alt=""
          size={16}
          className="shrink-0 text-foreground/80"
        />
      }
      accessory={
        showCount && (
          <span className="shrink-0 text-sm text-muted-foreground">
            {connections.length} connection{connections.length === 1 ? "" : "s"}
          </span>
        )
      }
    >
      {rows}
    </ListGroup>
  );
}
