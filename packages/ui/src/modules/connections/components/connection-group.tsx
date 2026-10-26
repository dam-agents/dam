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
  maintenance,
  onNewChild,
}: Props) {
  const { provider, connections } = group;
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
    </ListGroup>
  );
}
