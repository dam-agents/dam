import { Add } from "@carbon/icons-react";
import type { ConnectionTemplateView } from "api-server-api";
import type { ConnectionView } from "api-server-api";

import { SlackAccountExplainer } from "@/components/channel-connection-explainer";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";

import type { CatalogProviderGroup } from "../lib/catalog-providers.js";
import type { RowMaintenanceActions } from "./catalog-connection-row.js";
import { ConnectionIcon } from "./connection-icon.js";
import { ConnectionRowCard } from "./connection-row-card.js";

export interface SandboxGrantControls {
  grantedIds: ReadonlySet<string>;
  onToggleGrant: (id: string, on: boolean) => void;
}

interface Props {
  group: CatalogProviderGroup;
  templateById: Map<string, ConnectionTemplateView>;
  sandbox?: SandboxGrantControls;
  grantBlockedReason?: (connection: ConnectionView) => string | undefined;
  onNew: () => void;
  onDelete: (id: string, name: string) => void;
  deletingId: string | null;
  maintenance?: (
    connection: ConnectionView,
  ) => RowMaintenanceActions | undefined;
  onGoToChannels?: () => void;
}

export function CatalogProviderCard({
  group,
  templateById,
  sandbox,
  grantBlockedReason,
  onNew,
  onDelete,
  deletingId,
  maintenance,
  onGoToChannels,
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
    <section
      data-testid={`catalog-provider-${provider.id}`}
      className={CARD_SURFACE}
    >
      <header className="flex h-[52px] items-center gap-2.5 border-b border-border px-4">
        <ConnectionIcon
          iconSlug={provider.iconSlug}
          alt=""
          size={16}
          className="shrink-0 text-foreground/80"
        />
        <h3 className="min-w-0 truncate text-md font-semibold text-foreground">
          {provider.title}
        </h3>
        {provider.id === "slack" ? (
          <SlackAccountExplainer
            forAgent={sandbox !== undefined}
            onGoToChannels={onGoToChannels}
          />
        ) : undefined}
        {connections.length > 0 && newButton && (
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {newButton}
          </div>
        )}
      </header>
      {connections.length > 0 ? (
        <div className="flex flex-col gap-3 p-4">
          {connections.map((c) => (
            <ConnectionRowCard
              key={c.id}
              connection={c}
              template={templateById.get(c.templateId)}
              grant={
                sandbox && {
                  granted: sandbox.grantedIds.has(c.id),
                  onToggle: (on) => sandbox.onToggleGrant(c.id, on),
                  blockedReason: grantBlockedReason?.(c),
                }
              }
              onDelete={() => onDelete(c.id, c.name)}
              deleting={deletingId === c.id}
              maintenance={maintenance?.(c)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-start gap-3 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            No connections set up yet.
          </p>
          {newButton}
        </div>
      )}
    </section>
  );
}
