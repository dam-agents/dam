import type { KeyboardEvent } from "react";

/** Button semantics for a row or card that can't be a real `<button>` — one
 *  that wraps its own action menu or link, which a button may not contain.
 *
 *  Activates on click, Enter and Space. Space is the half hand-rolled rows keep
 *  missing, and it needs its default suppressed or the page scrolls instead.
 *  Keys are ignored unless they land on the row itself, so a nested control
 *  keeps its own Enter and Space.
 *
 *  Pass `undefined` to leave the element inert — a row that is only sometimes
 *  clickable then has no stale `role` or tab stop. */
export function clickableProps(onActivate: (() => void) | undefined) {
  if (!onActivate) return {};
  return {
    role: "button",
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      onActivate();
    },
  } as const;
}
