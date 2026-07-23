import type { ConnectionTemplateView, ConnectionView } from "api-server-api";

import type { CatalogProviderGroup } from "../lib/catalog-providers.js";
import { connectionKindSubtitle } from "../lib/catalog-providers.js";
import type { RowGrantControls } from "./catalog-connection-row.js";
import { CatalogConnectionRow } from "./catalog-connection-row.js";
import { ConnectionIcon } from "./connection-icon.js";
import { GithubAppInstallHint } from "./github-app-install-hint.js";

interface Props {
  group: CatalogProviderGroup;
  templateById: Map<string, ConnectionTemplateView>;
  showCount?: boolean;
  grant?: (connection: ConnectionView) => RowGrantControls | undefined;
  onManage?: () => void;
  onDelete?: (id: string, name: string) => void;
  deletingId?: string | null;
}

/** Provider group card listing existing connections — the "My connections"
 *  anatomy shared by the sandbox section and the settings page. */
export function ConnectionGroupCard({
  group,
  templateById,
  showCount = false,
  grant,
  onManage,
  onDelete,
  deletingId = null,
}: Props) {
  const { provider, connections } = group;
  return (
    <section
      data-testid={`connection-group-${provider.id}`}
      className="rounded-lg border border-border bg-card"
    >
      <header className="flex h-[52px] items-center gap-2.5 border-b border-border px-4">
        <ConnectionIcon
          iconSlug={provider.iconSlug}
          alt=""
          size={16}
          className="shrink-0 text-foreground/80"
        />
        <h3 className="truncate text-[15px] font-semibold text-foreground">
          {provider.title}
        </h3>
        {showCount && (
          <span className="text-[14px] text-muted-foreground">
            {connections.length} connection{connections.length === 1 ? "" : "s"}
          </span>
        )}
      </header>
      <GithubAppInstallHint connections={connections} />
      <div className="divide-y divide-border">
        {connections.map((c) => (
          <CatalogConnectionRow
            key={c.id}
            connection={c}
            subtitle={connectionKindSubtitle(c, templateById.get(c.templateId))}
            grant={grant?.(c)}
            onManage={onManage}
            onDelete={onDelete && (() => onDelete(c.id, c.name))}
            deleting={deletingId === c.id}
          />
        ))}
      </div>
    </section>
  );
}
