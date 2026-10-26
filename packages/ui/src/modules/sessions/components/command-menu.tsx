import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

import type { CommandMenu as CommandMenuState } from "../hooks/use-command-menu.js";
import { commandText, type SkillCommand } from "../lib/skill-commands.js";

export function CommandMenu({ menu }: { menu: CommandMenuState }) {
  const listRef = useRef<HTMLUListElement>(null);
  const { open, highlight, optionId } = menu;

  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`#${CSS.escape(optionId(highlight))}`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [open, highlight, optionId]);

  if (!open) return null;
  return (
    <ul
      ref={listRef}
      id={menu.listId}
      role="listbox"
      aria-label="Commands"
      className="absolute bottom-full left-0 right-0 z-popover mb-1.5 max-h-[280px] overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-md"
    >
      {menu.options.map((command, i) => (
        <CommandMenuOption
          key={command.name}
          id={optionId(i)}
          command={command}
          highlighted={i === highlight}
          onPick={() => menu.pick(command)}
          onHover={() => menu.setHighlight(i)}
        />
      ))}
    </ul>
  );
}

function CommandMenuOption({
  id,
  command,
  highlighted,
  onPick,
  onHover,
}: {
  id: string;
  command: SkillCommand;
  highlighted: boolean;
  onPick: () => void;
  onHover: () => void;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={highlighted}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      onMouseEnter={onHover}
      className={cn(
        "flex cursor-pointer items-baseline gap-3 rounded-md px-3 py-1.5 text-sm text-foreground",
        highlighted && "bg-muted",
      )}
    >
      <span className="shrink-0 font-mono text-[13px]">
        {commandText(command.name)}
      </span>
      {command.description && (
        <span className="truncate text-xs text-muted-foreground">
          {command.description}
        </span>
      )}
    </li>
  );
}
