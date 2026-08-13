import { Add } from "@carbon/icons-react";
import type { ConnectionTemplateView } from "api-server-api";
import type { ConnectionView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { PanelCard } from "@/components/ui/panel-card";

import type { CatalogProviderGroup } from "../lib/catalog-providers.js";
import { connectionKindSubtitle } from "../lib/catalog-providers.js";
import type { RowMaintenanceActions } from "./catalog-connection-row.js";
import { CatalogConnectionRow } from "./catalog-connection-row.js";
import { ConnectionIcon } from "./connection-icon.js";
import { GithubAppInstallHint } from "./github-app-install-hint.js";

export interface SandboxGrantControls {
  grantedIds: ReadonlySet<string>;
  onToggleGrant: (id: string, on: boolean) => void;
}

interface Props {
  group: CatalogProviderGroup;
  templateById: Map<string, ConnectionTemplateView>;
  sandbox?: SandboxGrantControls;
  onNew: () => void;
  onDelete: (id: string, name: string) => void;
  deletingId: string | null;
  /** Per-row credential maintenance; omit to offer none. */
  maintenance?: (
    connection: ConnectionView,
  ) => RowMaintenanceActions | undefined;
}

export function CatalogProviderCard({
  group,
  templateById,
  sandbox,
  onNew,
  onDelete,
  deletingId,
  maintenance,
}: Props) {
  const { provider, templates, connections } = group;

  const newButton = templates.length > 0 && (
    <Button
      variant="outline"
      size="sm"
      onClick={onNew}
      data-testid={`catalog-new-${provider.id}`}
    >
      <Add size={16} />
      New
    </Button>
  );

  return (
    <PanelCard
      testId={`catalog-provider-${provider.id}`}
      title={provider.title}
      icon={
        <ConnectionIcon
          iconSlug={provider.iconSlug}
          alt=""
          size={16}
          className="shrink-0 text-foreground/80"
        />
      }
      headerRight={connections.length > 0 && newButton}
    >
      {connections.length > 0 ? (
        <>
          <GithubAppInstallHint connections={connections} />
          <div className="divide-y divide-border">
            {connections.map((c) => (
              <CatalogConnectionRow
                key={c.id}
                connection={c}
                subtitle={connectionKindSubtitle(
                  c,
                  templateById.get(c.templateId),
                )}
                grant={
                  sandbox && {
                    granted: sandbox.grantedIds.has(c.id),
                    onToggle: (on) => sandbox.onToggleGrant(c.id, on),
                  }
                }
                onDelete={() => onDelete(c.id, c.name)}
                deleting={deletingId === c.id}
                maintenance={maintenance?.(c)}
              />
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-start gap-3 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            No connections set up yet.
          </p>
          {newButton}
        </div>
      )}
    </PanelCard>
  );
}
