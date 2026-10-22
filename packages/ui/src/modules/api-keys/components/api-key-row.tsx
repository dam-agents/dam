import { Password } from "@carbon/icons-react";
import type { ApiKeyView } from "api-server-api";

import { LIST_ROW } from "@/components/ui/list-section";
import { RemoveButton } from "@/components/ui/remove-button";
import { cn } from "@/lib/utils";

import { formatRunTime } from "../../schedules/lib/schedule-format.js";

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
          <span
            className="truncate text-md font-medium text-foreground"
            title={id}
          >
            {name}
          </span>
        </div>
        <div className="mt-0.5 text-sm text-muted-foreground">
          {scopes.join(", ")} · {binding}
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          Created {formatRunTime(createdAt)}
          {expiresAt && ` · expires ${formatRunTime(expiresAt)}`}
          {lastUsedAt
            ? ` · last used ${formatRunTime(lastUsedAt)}`
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
