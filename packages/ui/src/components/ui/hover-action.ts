/** A row action revealed on hover. Goes on the action, or on a wrapper around
 *  several — hence both `focus-within` and `has()`, which a bare
 *  `focus-visible`/`data-state` pair can't match from a wrapper. Each reveal
 *  outranks the hidden base on specificity, not order. */
export const HOVER_ACTION =
  "transition-opacity hover-capable:opacity-0 group-hover:opacity-100 focus-within:opacity-100 data-[state=open]:opacity-100 has-[[data-state=open]]:opacity-100";
