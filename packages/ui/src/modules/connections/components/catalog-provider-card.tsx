import { Add } from "@carbon/icons-react";
import type { ConnectionTemplateView } from "api-server-api";

import { Button } from "@/components/ui/button";

import type { CatalogProviderGroup } from "../lib/catalog-providers.js";
import { connectionKindSubtitle } from "../lib/catalog-providers.js";
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
}

export function CatalogProviderCard({
  group,
  templateById,
  sandbox,
  onNew,
  onDelete,
  deletingId,
}: Props) {
  const { provider, templates, connections } = group;

  const newButton = templates.length > 0 && (
    <Button
      variant="outline"
      className="h-[32px] px-3 text-[14px] font-normal"
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
      className="rounded-lg border border-border bg-card"
    >
      <header className="flex h-[52px] items-center gap-2.5 border-b border-border px-4">
        <ConnectionIcon
          iconSlug={provider.iconSlug}
          alt=""
          size={16}
          className="shrink-0 text-foreground/80"
        />
        <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold text-foreground">
          {provider.title}
        </h3>
        {connections.length > 0 && newButton}
      </header>
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
              />
            ))}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-start gap-3 px-4 py-4">
          <p className="text-[14px] text-muted-foreground">
            No connections set up yet.
          </p>
          {newButton}
        </div>
      )}
    </section>
  );
}
