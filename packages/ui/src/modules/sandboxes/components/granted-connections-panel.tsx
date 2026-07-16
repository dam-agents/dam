import { Add } from "@carbon/icons-react";
import type { ConnectionTemplateView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Inset } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";

import { ConnectionGroupCard } from "../../connections/components/connection-group-card.js";
import type { CatalogProviderGroup } from "../../connections/lib/catalog-providers.js";

interface Props {
  groups: CatalogProviderGroup[];
  templateById: Map<string, ConnectionTemplateView>;
  onToggleGrant: (id: string, on: boolean) => void;
  onOpenCatalog: () => void;
}

/** The sandbox's granted connections, grouped by provider, with the entry
 *  point into the catalogue — shared by the sandbox home section and the
 *  create wizard step. */
export function GrantedConnectionsPanel({
  groups,
  templateById,
  onToggleGrant,
  onOpenCatalog,
}: Props) {
  if (groups.length === 0)
    return (
      <>
        <SectionLabel spaced>My connections</SectionLabel>
        <Inset className="rounded-lg border border-border bg-card">
          <div className="flex flex-col items-center gap-4 py-10">
            <p className="text-[14px] text-foreground/80">
              You have not added any Connections to this Sandbox yet
            </p>
            <Button
              variant="outline"
              className="h-[40px] text-[14px]"
              onClick={onOpenCatalog}
              data-testid="open-connection-catalog"
            >
              <Add size={16} />
              Add Connection
            </Button>
          </div>
        </Inset>
      </>
    );

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <SectionLabel>My connections</SectionLabel>
        <Button
          variant="outline"
          className="h-[32px] px-3 text-[14px] font-normal"
          onClick={onOpenCatalog}
          data-testid="open-connection-catalog"
        >
          <Add size={16} />
          New
        </Button>
      </div>
      <Inset className="flex flex-col gap-4">
        {groups.map((group) => (
          <ConnectionGroupCard
            key={group.provider.id}
            group={group}
            templateById={templateById}
            showCount
            grant={(c) => ({
              granted: true,
              onToggle: (on) => onToggleGrant(c.id, on),
              actionHidden: true,
            })}
            onManage={onOpenCatalog}
          />
        ))}
      </Inset>
    </>
  );
}
