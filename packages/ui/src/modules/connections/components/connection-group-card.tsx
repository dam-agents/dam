import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import { PanelCard } from "@/components/ui/panel-card";

import type { CatalogProviderGroup } from "../lib/catalog-providers.js";
import type {
  RowGrantControls,
  RowMaintenanceActions,
} from "./catalog-connection-row.js";
import { ConnectionIcon } from "./connection-icon.js";
import { ConnectionRowCard } from "./connection-row-card.js";

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
  badge?: React.ReactNode;
}

export function ConnectionGroupCard({
  group,
  templateById,
  showCount = false,
  grant,
  onManage,
  onDelete,
  deletingId = null,
  maintenance,
  badge,
}: Props) {
  const { provider, connections } = group;
  return (
    <PanelCard
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
      titleAccessory={
        (showCount || badge) && (
          <span className="flex shrink-0 items-center gap-2">
            {showCount && (
              <span className="text-sm text-muted-foreground">
                {connections.length} connection
                {connections.length === 1 ? "" : "s"}
              </span>
            )}
            {badge}
          </span>
        )
      }
    >
      <div className="flex flex-col gap-3 p-4">
        {connections.map((c) => (
          <ConnectionRowCard
            key={c.id}
            connection={c}
            template={templateById.get(c.templateId)}
            grant={grant?.(c)}
            onManage={onManage}
            onDelete={onDelete && (() => onDelete(c.id, c.name))}
            deleting={deletingId === c.id}
            maintenance={maintenance?.(c)}
          />
        ))}
      </div>
    </PanelCard>
  );
}
