import { Key, TrashCan } from "@carbon/icons-react";
import type { ApiKeyView } from "api-server-api";

import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
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
    <li className={cn(CARD_SURFACE, "flex items-start gap-3 rounded-xl p-4")}>
      <Key size={20} className="text-muted-foreground mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] font-semibold truncate">{name}</span>
          <span className="text-[11px] text-muted-foreground font-mono">
            {id}
          </span>
        </div>
        <div className="text-[12px] text-muted-foreground mt-1">
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
      <Button
        variant="ghost"
        size="icon-sm"
        tone="danger"
        onClick={() => onRevoke(id, name)}
        disabled={revoking}
        className="shrink-0 text-muted-foreground"
        title="Revoke"
      >
        <TrashCan size={14} />
      </Button>
    </li>
  );
}
