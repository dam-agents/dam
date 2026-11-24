import { Add } from "@carbon/icons-react";
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import { SlackAccountExplainer } from "@/components/channel-connection-explainer";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";

import { useFeatures } from "../../features/api/queries.js";
import type { ConnectionHolders } from "../hooks/use-connection-holders.js";
import type { CatalogProviderGroup } from "../lib/catalog-providers.js";
import { isGrantable } from "../lib/connection-hierarchy.js";
import {
  canGrantConnection,
  damConnectionOffered,
} from "../lib/dam-connection.js";
import type { RowMaintenanceActions } from "./catalog-connection-row.js";
import { ConnectionIcon } from "./connection-icon.js";
import { ConnectionRows } from "./connection-rows.js";

export interface SandboxGrantControls {
  grantedIds: ReadonlySet<string>;
  onToggleGrant: (id: string, on: boolean) => void;
  onRevoke: (ids: readonly string[]) => void;
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
  onNewChild?: (parent: ConnectionView) => void;
  holders?: ConnectionHolders | null;
}

// UNIT_BOUNDARY_DESCRIPTION: one provider in the connection catalog and on the Connections page: its name and New on one line, and below it a card for each GitHub sign-in or App installation and for each connection an agent holds directly. In an agent's catalog a connection's row offers to add it to the agent; on the Connections page, where there is no agent, it says which agents use it.
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
  onNewChild,
  holders,
}: Props) {
  const { provider, templates, connections } = group;
  const damOffered = damConnectionOffered(useFeatures().data);

  const newButton = templates.length > 0 && (
    <Button
      variant="outline"
      size="sm"
      onClick={onNew}
      data-testid={`catalog-new-${provider.id}`}
    >
      New
      <Add size={16} />
    </Button>
  );

  return (
    <section data-testid={`catalog-provider-${provider.id}`}>
      <header className="mb-2 flex min-h-8 items-center gap-2.5">
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
        <div className="flex flex-col gap-3">
          <ConnectionRows
            cards
            connections={connections}
            templateById={templateById}
            grant={
              sandbox &&
              ((c) =>
                isGrantable(c) && canGrantConnection(damOffered, c)
                  ? {
                      granted: sandbox.grantedIds.has(c.id),
                      onToggle: (on) => sandbox.onToggleGrant(c.id, on),
                      blockedReason: grantBlockedReason?.(c),
                    }
                  : undefined)
            }
            onDelete={onDelete}
            deletingId={deletingId}
            maintenance={maintenance}
            onNewChild={onNewChild}
            holders={holders}
          />
        </div>
      ) : (
        <div
          className={`${CARD_SURFACE} flex flex-col items-start gap-3 px-4 py-4`}
        >
          {newButton}
        </div>
      )}
    </section>
  );
}
