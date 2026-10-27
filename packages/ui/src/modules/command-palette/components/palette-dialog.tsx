import { Search } from "@carbon/icons-react";
import { useEffect, useId, useState } from "react";
import { match } from "ts-pattern";

import { DialogHeader, Modal } from "@/components/modal";

import { usePaletteInput } from "../hooks/use-palette-input.js";
import { useFrecency } from "../hooks/use-palette-storage.js";
import { buildCommands } from "../lib/commands.js";
import type { PaletteActions, PaletteCommand } from "../lib/palette-command.js";
import { rankCommands } from "../lib/ranking.js";
import { PaletteItem } from "./palette-item.js";
import { PalettePrompt } from "./palette-prompt.js";

type Prompt = Extract<PaletteCommand["perform"], { kind: "input" }> & {
  id: string;
};

const IME_PROCESS_KEY = 229;

const KEYS: Partial<Record<string, "down" | "up" | "run">> = {
  ArrowDown: "down",
  ArrowUp: "up",
  Enter: "run",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the open command palette: a search field over
 * the ranked commands as a combobox and its listbox, whose active descendant
 * is always the highlighted command. Arrow keys move the highlight and wrap,
 * a new query highlights its best command, and the highlight stays on its
 * command when late data reorders the list. Enter runs it after the
 * palette closes, so focus is back where it was before a confirmation the
 * command asks for takes it; a command that needs a value, such as a new
 * name, asks for it in the palette first.
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
  const listId = useId();
  const [now] = useState(Date.now);
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
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
  const highlighted = Math.max(
    0,
    ranked.findIndex((command) => command.id === activeId),
  );
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    document
      .getElementById(`${listId}-${highlighted}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [listId, highlighted]);

  const finish = (id: string, run: () => unknown) => {
    frecency.record(id);
    onClose();
    setTimeout(run, 0);
  };
  const choose = (command: PaletteCommand) =>
    match(command.perform)
      .with({ kind: "run" }, ({ run }) => finish(command.id, run))
      .with({ kind: "input" }, (perform) =>
        setPrompt({ ...perform, id: command.id }),
      )
      .exhaustive();
  const step = (by: number) =>
    setActiveId(ranked[(highlighted + by + ranked.length) % ranked.length]!.id);

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
        <>
          <div className="flex items-center gap-3 border-b border-border px-4">
            <Search
              size={16}
              className="shrink-0 text-muted-foreground"
              aria-hidden
            />
            <input
              role="combobox"
              aria-label="Command palette"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                ranked.length > 0 ? optionId(highlighted) : undefined
              }
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveId(null);
              }}
              onKeyDown={(event) => {
                const key = KEYS[event.key];
                if (
                  !key ||
                  event.nativeEvent.isComposing ||
                  event.keyCode === IME_PROCESS_KEY ||
                  ranked.length === 0
                )
                  return;
                event.preventDefault();
                if (key === "run") choose(ranked[highlighted]!);
                else step(key === "down" ? 1 : -1);
              }}
              placeholder="Type a command or search"
              data-testid="command-palette-input"
              className="h-12 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-placeholder"
            />
          </div>
          {ranked.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No matching commands
            </p>
          )}
          <ul
            id={listId}
            role="listbox"
            aria-label="Commands"
            className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-gutter:stable]"
          >
            {ranked.map((command, index) => (
              <PaletteItem
                key={command.id}
                id={optionId(index)}
                command={command}
                selected={index === highlighted}
                onPoint={() => setActiveId(command.id)}
                onSelect={() => choose(command)}
              />
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}
