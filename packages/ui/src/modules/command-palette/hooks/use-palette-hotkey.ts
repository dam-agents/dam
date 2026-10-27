import { useEffect } from "react";

const MAC = /Mac|iP(hone|ad|od)/.test(navigator.platform);

function letterOf(event: KeyboardEvent): string {
  return /^[a-z]$/i.test(event.key)
    ? event.key.toLowerCase()
    : event.code.replace(/^Key/, "").toLowerCase();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the command palette's only entry point, Cmd-K
 * or Cmd-Shift-P on a Mac and Ctrl-K or Ctrl-Shift-P elsewhere. It listens in
 * the capture phase, so a focused editor or composer cannot swallow it. Ctrl-K
 * inside the web terminal stays the shell's kill-line; Ctrl-Shift-P still
 * opens the palette there. On a layout whose keys type non-Latin letters,
 * the key in the K or P position counts.
 */
export function usePaletteHotkey(toggle: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey) return;
      const mod = MAC
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (!mod) return;
      const letter = letterOf(event);
      const palette =
        (letter === "k" && !event.shiftKey) ||
        (letter === "p" && event.shiftKey);
      if (!palette) return;
      if (
        !MAC &&
        letter === "k" &&
        event.target instanceof Element &&
        event.target.closest(".xterm")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      toggle();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [toggle]);
}
