import type { KeyboardEvent } from "react";

/** Button semantics for a row that can't be a real `<button>` because it wraps
 *  its own menu or link. Keys are ignored unless they land on the row itself,
 *  so a nested control keeps its own Enter and Space. `undefined` leaves the
 *  element inert, with no stale `role` or tab stop. */
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
