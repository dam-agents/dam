import { Password } from "@carbon/icons-react";
import type { ApiKeyView } from "api-server-api";

import { LIST_ROW } from "@/components/ui/list-section";
import { RemoveButton } from "@/components/ui/remove-button";
import { formatDate } from "@/lib/format-time";
import { cn } from "@/lib/utils";

interface Props {
  apiKey: ApiKeyView;
  onRevoke: (id: string, name: string) => void;
  revoking: boolean;
}

export function ApiKeyRow({ apiKey, onRevoke, revoking }: Props) {
  const { id, name, scopes, agentIds, createdAt, expiresAt, lastUsedAt } =
    apiKey;
  const binding =
    agentIds === "*"
      ? "all owned agents"
      : `${agentIds.length} agent${agentIds.length === 1 ? "" : "s"}`;

  return (
    <div className={cn(LIST_ROW, "items-start")}>
      <Password size={20} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-md font-medium text-foreground">
            {name}
          </span>
          <span className="font-mono text-xs text-muted-foreground">{id}</span>
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {scopes.join(", ")} · {binding}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          created {formatDate(createdAt)}
          {expiresAt && ` · expires ${formatDate(expiresAt)}`}
          {lastUsedAt
            ? ` · last used ${formatDate(lastUsedAt)}`
            : " · never used"}
        </div>
      </div>
      <RemoveButton
        label="Revoke key"
        onClick={() => onRevoke(id, name)}
        disabled={revoking}
      />
    </div>
  );
}
