/** A row action revealed on hover. Goes on the action inside a `group` row.
 *  Every reveal is `md:`-scoped so it outranks `md:opacity-0`, which Tailwind
 *  emits later in the same media query. */
export const HOVER_ACTION =
  "transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 md:data-[state=open]:opacity-100";
