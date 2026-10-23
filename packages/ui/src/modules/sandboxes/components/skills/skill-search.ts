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
