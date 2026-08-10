/** Case-insensitive substring match over a skill's name and description — the
 *  two fields #3023 names. Shared by every group on the surface so they can't
 *  disagree about what counts as a match. `query` is expected pre-lowercased. */
export function filterByQuery<T extends { name: string; description: string }>(
  items: T[],
  query: string,
): T[] {
  if (!query) return items;
  return items.filter((item) =>
    `${item.name} ${item.description}`.toLowerCase().includes(query),
  );
}
