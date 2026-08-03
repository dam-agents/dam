/** A row action that only shows on hover — the "…" menu, an inline remove.
 *
 *  Belongs on the action itself (or its wrapper) inside a `group` row. Stays
 *  visible below `md`, where there is no hover to reveal it at all, and from
 *  `md` up is also revealed while focused or while its menu is open —
 *  otherwise a keyboard user tabs onto an invisible control. Every reveal is
 *  `md:`-scoped so it outranks `md:opacity-0`, which Tailwind emits inside the
 *  same media query. */
export const HOVER_ACTION =
  "transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100";
