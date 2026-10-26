import {
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useId,
  useMemo,
  useState,
} from "react";

import {
  commandTrigger,
  filterCommands,
  insertCommand,
  type SkillCommand,
} from "../lib/skill-commands.js";

export interface CommandMenu {
  open: boolean;
  options: SkillCommand[];
  highlight: number;
  listId: string;
  optionId: (index: number) => string;
  setHighlight: (index: number) => void;
  pick: (command: SkillCommand) => void;
  track: (el: HTMLTextAreaElement) => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  inputProps: {
    role?: "combobox";
    "aria-autocomplete"?: "list";
    "aria-expanded"?: boolean;
    "aria-controls"?: string;
    "aria-activedescendant"?: string;
    onSelect: () => void;
    onFocus: () => void;
    onBlur: () => void;
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the `/` command list of the chat input. It
 * follows the caret, so it opens on a `/` at the start of a line and closes
 * once the caret leaves that token. While it is open it takes ↑/↓, Enter, Tab
 * and Esc before the input does; when it is closed, every key reaches the
 * input's own handling (send, newline, prompt history). Esc closes it for
 * the text typed so far; typing more, or a new command, opens it again.
 */
export function useCommandMenu(input: {
  commands: readonly SkillCommand[];
  text: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  apply: (text: string) => void;
}): CommandMenu {
  const { commands, text, textareaRef, apply } = input;
  const [caret, setCaret] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [highlightState, setHighlightState] = useState({ key: "", index: 0 });
  const listId = useId();

  const trigger =
    caret === null || commands.length === 0
      ? null
      : commandTrigger(text, Math.min(caret, text.length));
  const query = trigger?.query ?? null;
  const options = useMemo(
    () => (query === null ? [] : filterCommands(commands, query)),
    [commands, query],
  );
  const key = trigger ? `${trigger.start}:${trigger.query}` : "";
  if (key === "" && dismissed !== null) setDismissed(null);
  const open =
    focused && trigger !== null && options.length > 0 && dismissed !== key;
  const highlight =
    highlightState.key === key
      ? Math.min(highlightState.index, options.length - 1)
      : 0;
  const setHighlight = useCallback(
    (index: number) => setHighlightState({ key, index }),
    [key],
  );

  const track = useCallback((el: HTMLTextAreaElement | null) => {
    setCaret(
      el && el.selectionStart === el.selectionEnd ? el.selectionEnd : null,
    );
  }, []);
  const readCaret = useCallback(
    () => track(textareaRef.current),
    [track, textareaRef],
  );

  const pick = useCallback(
    (command: SkillCommand) => {
      if (!trigger) return;
      const next = insertCommand(text, trigger, command.name);
      apply(next.text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(next.caret, next.caret);
        track(el);
      });
    },
    [trigger, text, apply, textareaRef, track],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open || e.nativeEvent.isComposing) return false;
      if (e.altKey || e.metaKey || e.ctrlKey) return false;
      const last = options.length - 1;
      switch (e.key) {
        case "ArrowDown":
          setHighlight(highlight >= last ? 0 : highlight + 1);
          return true;
        case "ArrowUp":
          setHighlight(highlight <= 0 ? last : highlight - 1);
          return true;
        case "Enter":
        case "Tab":
          if (e.shiftKey) return false;
          pick(options[highlight]!);
          return true;
        case "Escape":
          setDismissed(key);
          return true;
        default:
          return false;
      }
    },
    [open, options, highlight, setHighlight, pick, key],
  );

  const optionId = useCallback(
    (index: number) => `${listId}-option-${index}`,
    [listId],
  );

  return {
    open,
    options,
    highlight,
    listId,
    optionId,
    setHighlight,
    pick,
    track,
    onKeyDown,
    inputProps: {
      ...(commands.length > 0 && {
        role: "combobox",
        "aria-autocomplete": "list",
        "aria-expanded": open,
        "aria-controls": listId,
        "aria-activedescendant": open ? optionId(highlight) : undefined,
      }),
      onSelect: readCaret,
      onFocus: () => {
        setFocused(true);
        readCaret();
      },
      onBlur: () => setFocused(false),
    },
  };
}
