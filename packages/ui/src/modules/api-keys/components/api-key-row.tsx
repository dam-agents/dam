import type { ApiKeyView } from "api-server-api";
import { KeyRound, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

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
    <li className="flex items-start gap-3 p-4 rounded-xl border border-border bg-card">
      <KeyRound size={20} className="text-muted-foreground mt-0.5 shrink-0" />
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
          created {new Date(createdAt).toLocaleDateString()}
          {expiresAt &&
            ` · expires ${new Date(expiresAt).toLocaleDateString()}`}
          {lastUsedAt
            ? ` · last used ${new Date(lastUsedAt).toLocaleDateString()}`
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
        <Trash2 size={14} />
      </Button>
    </li>
  );
}
