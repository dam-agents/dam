/** Case-insensitive substring match over a skill's name and description — the
 *  two fields the search covers. Shared by every group on the surface so they
 *  can't disagree about what counts as a match. Lowercases the query itself:
 *  the alternative is a docblock contract no type can enforce, whose only
 *  failure mode is every skill silently not matching. */
export function filterByQuery<T extends { name: string; description: string }>(
  items: T[],
  query: string,
): T[] {
  const needle = query.toLowerCase();
  if (!needle) return items;
  return items.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(needle),
  );
}
