import type { StartupItem } from "agent-runtime-api";

import { clickableProps } from "@/lib/clickable";
import { cn } from "@/lib/utils";

import { loginItemOutputKey, loginItemStatus } from "../lib/process-copy.js";
import { LoginItemActionsMenu } from "./login-item-actions-menu.js";
import { ProcessCommand } from "./process-command.js";

interface Props {
  agentId: string;
  item: StartupItem;
  openOutputKey: string | null;
  onOpenOutput: (key: string) => void;
}

export function LoginItemRow({
  agentId,
  item,
  openOutputKey,
  onOpenOutput,
}: Props) {
  const outputKey = loginItemOutputKey(item.id);
  const outputOpen = outputKey === openOutputKey;
  const toggleOutput = () => onOpenOutput(outputKey);

  return (
    <li
      data-testid="login-item-row"
      data-item={item.id}
      aria-pressed={outputOpen}
      className={cn(
        "group flex cursor-pointer items-center gap-2 border-b border-border py-2.5 pl-4 pr-2 transition-colors",
        outputOpen ? "bg-muted" : "hover:bg-muted/60",
        item.disabled && "text-muted-foreground",
      )}
      {...clickableProps(toggleOutput)}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              item.running
                ? "bg-success motion-safe:animate-pulse"
                : "bg-muted-foreground/40",
            )}
          />
          <ProcessCommand command={item.command} title={item.command} />
        </div>
        <span className="truncate text-2xs text-muted-foreground">
          {item.id} · {loginItemStatus(item)}
        </span>
      </div>
      <LoginItemActionsMenu
        agentId={agentId}
        item={item}
        outputOpen={outputOpen}
        onToggleOutput={toggleOutput}
      />
    </li>
  );
}
