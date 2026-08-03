/** A row action revealed on hover. Goes on the action, or on a wrapper around
 *  several — hence both `focus-within` and `has()`, which a bare
 *  `focus-visible`/`data-state` pair can't match from a wrapper. Every reveal
 *  is `md:`-scoped so it outranks `md:opacity-0`, which Tailwind emits later in
 *  the same media query. */
export const HOVER_ACTION =
  "transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 md:data-[state=open]:opacity-100 md:has-[[data-state=open]]:opacity-100";
