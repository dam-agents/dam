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
          <span className="text-sm font-semibold truncate">{name}</span>
          <span className="text-[11px] text-muted-foreground font-mono">
            {id}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          {scopes.join(", ")} · {binding}
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
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
