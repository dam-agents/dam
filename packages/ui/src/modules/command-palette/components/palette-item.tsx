import { cn } from "@/lib/utils";

import type { PaletteCommand } from "../lib/palette-command.js";

export function PaletteItem({
  id,
  command,
  selected,
  onPoint,
  onSelect,
}: {
  id: string;
  command: PaletteCommand;
  selected: boolean;
  onPoint: () => void;
  onSelect: () => void;
}) {
  const muted = !command.destructive && "text-muted-foreground";
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      onPointerMove={onPoint}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onSelect}
      data-testid="command-palette-item"
      className={cn(
        "flex h-9 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-sm",
        command.destructive ? "text-danger" : "text-foreground",
        selected && (command.destructive ? "bg-danger-light" : "bg-muted"),
      )}
    >
      <command.icon className={cn("size-4 shrink-0", muted)} aria-hidden />
      <span className="min-w-0 truncate">
        {command.prefix && <span className={cn(muted)}>{command.prefix}</span>}
        {command.label}
      </span>
    </li>
  );
}
