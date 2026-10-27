import { Search } from "@carbon/icons-react";
import { Command } from "cmdk";
import { useState } from "react";

import { DialogHeader, Modal } from "@/components/modal";
import { cn } from "@/lib/utils";

import { usePaletteInput } from "../hooks/use-palette-input.js";
import { useFrecency } from "../hooks/use-palette-storage.js";
import {
  buildCommands,
  type PaletteActions,
  type PaletteCommand,
} from "../lib/commands.js";
import { rankCommands } from "../lib/ranking.js";
import { PalettePrompt } from "./palette-prompt.js";

type Prompt = Extract<PaletteCommand["perform"], { kind: "input" }> & {
  id: string;
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the open command palette: a search field over
 * the ranked commands as a combobox and its listbox. Enter runs the selected
 * command after the palette closes, so focus is back where it was before a
 * confirmation the command asks for takes it; a command that needs a value,
 * such as a new name, asks for it in the palette first.
 */
export function PaletteDialog({
  actions,
  onClose,
}: {
  actions: PaletteActions;
  onClose: () => void;
}) {
  const input = usePaletteInput();
  const frecency = useFrecency();
  const [now] = useState(Date.now);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [prompt, setPrompt] = useState<Prompt | null>(null);

  const { route } = input;
  const ranked = rankCommands(buildCommands(input, actions), query, {
    now,
    agentId: route.agentId,
    action:
      route.view === "sandbox-home" && route.section
        ? `configure:${route.section}`
        : null,
    frecency: (id) => frecency.usesOf(id, now),
  });
  const value = ranked.some((c) => c.id === selected)
    ? selected
    : (ranked[0]?.id ?? "");

  const finish = (id: string, run: () => unknown) => {
    frecency.record(id);
    onClose();
    setTimeout(run, 0);
  };
  const choose = (command: PaletteCommand) => {
    const { perform } = command;
    if (perform.kind === "input") setPrompt({ ...perform, id: command.id });
    else finish(command.id, perform.run);
  };

  return (
    <Modal size="md" heightClass="h-[min(28rem,80dvh)]" onClose={onClose}>
      <DialogHeader title="Command palette" className="sr-only" />
      {prompt ? (
        <PalettePrompt
          label={prompt.label}
          initial={prompt.initial}
          onSubmit={(next) =>
            next === prompt.initial
              ? onClose()
              : finish(prompt.id, () => prompt.submit(next))
          }
        />
      ) : (
        <Command
          label="Command palette"
          shouldFilter={false}
          loop
          value={value}
          onValueChange={setSelected}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search
              size={16}
              className="shrink-0 text-muted-foreground"
              aria-hidden
            />
            <Command.Input
              value={query}
              onValueChange={(next) => {
                setQuery(next);
                setSelected("");
              }}
              autoFocus
              placeholder="Type a command or search"
              data-testid="command-palette-input"
              className="h-12 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
            />
          </div>
          <Command.List
            label="Commands"
            className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-gutter:stable]"
          >
            <Command.Empty className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matching commands
            </Command.Empty>
            {ranked.map((command) => (
              <Command.Item
                key={command.id}
                value={command.id}
                onSelect={() => choose(command)}
                data-testid="command-palette-item"
                className={cn(
                  "flex h-9 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-sm",
                  command.danger
                    ? "text-danger data-[selected=true]:bg-danger-light"
                    : "text-foreground data-[selected=true]:bg-muted",
                )}
              >
                <command.icon
                  className={cn(
                    "size-4 shrink-0",
                    !command.danger && "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 truncate">
                  {command.prefix && (
                    <span
                      className={cn(!command.danger && "text-muted-foreground")}
                    >
                      {command.prefix}
                    </span>
                  )}
                  {command.label}
                </span>
              </Command.Item>
            ))}
          </Command.List>
        </Command>
      )}
    </Modal>
  );
}
