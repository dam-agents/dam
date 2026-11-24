import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import { PanelCard } from "@/components/ui/panel-card";

import {
  type RowGrantControls,
  type RowMaintenanceActions,
  StatusBadges,
} from "../../../connections/components/catalog-connection-row.js";
import { ConnectionIcon } from "../../../connections/components/connection-icon.js";
import { ConnectionRowMenu } from "../../../connections/components/connection-row-actions.js";
import {
  type CatalogProviderGroup,
  connectionKindSubtitle,
} from "../../../connections/lib/catalog-providers.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: One provider's Connections in the + menu, as the
 * chat refresh design's ConnectionGroupCard draws them: a card with the
 * provider's icon, name and count, then one row per Connection with its name,
 * its status, what kind it is under it, and its menu behind the design's ⋯. A viewer who may not
 * change the Agent's Connections sees the rows with no menu.
 */
export function QuickConnectionGroup({
  group,
  templateById,
  grant,
  maintenance,
}: {
  group: CatalogProviderGroup;
  templateById: Map<string, ConnectionTemplateView>;
  grant?: (connection: ConnectionView) => RowGrantControls | undefined;
  maintenance?: (
    connection: ConnectionView,
  ) => RowMaintenanceActions | undefined;
}) {
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
        <span className="shrink-0 text-sm text-muted-foreground">
          {connections.length} connection{connections.length === 1 ? "" : "s"}
        </span>
      }
    >
      <div className="divide-y divide-border">
        {connections.map((c) => {
          const subtitle = connectionKindSubtitle(
            c,
            templateById.get(c.templateId),
          );
          const actions = maintenance?.(c);
          const grantControls = grant?.(c);
          return (
            <div
              key={c.id}
              data-testid={`catalog-connection-${c.id}`}
              className="flex items-center gap-2 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <p className="truncate text-[15px] text-foreground">
                    {c.name}
                  </p>
                  <StatusBadges connection={c} />
                </div>
                {subtitle && (
                  <p className="truncate text-sm text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </div>
              {(grantControls || actions) && (
                <ConnectionRowMenu
                  connection={c}
                  grant={grantControls}
                  maintenance={actions}
                  horizontal
                />
              )}
            </div>
          );
        })}
      </div>
    </PanelCard>
  );
}
