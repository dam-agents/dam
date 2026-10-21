import {
  Document,
  Restart,
  StopFilledAlt,
  TrashCan,
} from "@carbon/icons-react";
import type { StartupItem } from "agent-runtime-api";

import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";

import { useStore } from "../../../store.js";
import {
  useRemoveStartupItem,
  useRestartStartupItem,
  useSetStartupItemEnabled,
  useStopStartupItem,
} from "../api/mutations.js";
import { loginItemBootCaption } from "../lib/process-copy.js";
import { MenuItemText } from "./menu-item-text.js";

interface Props {
  agentId: string;
  item: StartupItem;
  outputOpen: boolean;
  onToggleOutput: () => void;
}

export function LoginItemActionsMenu({
  agentId,
  item,
  outputOpen,
  onToggleOutput,
}: Props) {
  const showConfirm = useStore((s) => s.showConfirm);
  const restart = useRestartStartupItem(agentId);
  const stop = useStopStartupItem(agentId);
  const remove = useRemoveStartupItem(agentId);
  const setEnabled = useSetStartupItemEnabled(agentId);

  async function handleRemove() {
    const confirmed = await showConfirm(
      <>
        Remove the login item{" "}
        <code className="font-mono break-all text-foreground">{item.id}</code>?
        It stops now and no longer starts when the agent wakes.
      </>,
      "Remove login item?",
      { confirmLabel: "Remove" },
    );
    if (confirmed) remove.mutate(item.id);
  }

  return (
    <RowActionsMenu
      label={`Actions for login item ${item.id}`}
      testId="login-item-menu-button"
      dense
      className={HOVER_ACTION}
      stopPropagation
      contentProps={{
        className: "w-64",
        onClick: (event) => event.stopPropagation(),
      }}
    >
      <DropdownMenuItem onSelect={onToggleOutput}>
        <Document size={14} />
        {outputOpen ? "Close output" : "Show output"}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuCheckboxItem
        checked={item.listed && !item.disabled}
        disabled={!item.listed || setEnabled.isPending}
        onCheckedChange={(enabled) =>
          setEnabled.mutate({ id: item.id, enabled })
        }
        data-testid="login-item-enabled"
        className="h-auto py-2"
      >
        <MenuItemText
          label="Start when the agent wakes"
          caption={loginItemBootCaption(item)}
        />
      </DropdownMenuCheckboxItem>
      <DropdownMenuItem
        disabled={!item.listed || item.disabled || restart.isPending}
        onSelect={() => restart.mutate(item.id)}
        data-testid="login-item-restart"
      >
        <Restart size={14} />
        {item.running ? "Restart" : "Start"}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={!item.running || stop.isPending}
        onSelect={() => stop.mutate(item.id)}
        data-testid="login-item-stop"
      >
        <StopFilledAlt size={14} />
        Stop
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        tone="danger"
        disabled={remove.isPending}
        onSelect={() => void handleRemove()}
        data-testid="login-item-remove"
      >
        <TrashCan size={14} />
        Remove…
      </DropdownMenuItem>
    </RowActionsMenu>
  );
}
