export interface PinDrop {
  id: string;
  after: boolean;
}

export function pinnedFirst<T>(
  items: readonly T[],
  pins: readonly string[],
  idOf: (item: T) => string,
): { items: T[]; pinned: ReadonlySet<string> } {
  const byId = new Map(items.map((item) => [idOf(item), item]));
  const head = pins.flatMap((id) => byId.get(id) ?? []);
  const pinned = new Set(head.map(idOf));
  return {
    items: [...head, ...items.filter((item) => !pinned.has(idOf(item)))],
    pinned,
  };
}

export function togglePin(pins: readonly string[], id: string): string[] {
  return pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id];
}

export function movePin(
  pins: readonly string[],
  id: string,
  drop: PinDrop | null,
): string[] {
  if (drop === null || drop.id === id)
    return pins.includes(id) ? [...pins] : [...pins, id];
  const rest = pins.filter((p) => p !== id);
  if (!rest.includes(drop.id)) return [...rest, id];
  const at = rest.indexOf(drop.id) + (drop.after ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}

export function stepPin(
  pins: readonly string[],
  id: string,
  step: -1 | 1,
  shown: ReadonlySet<string>,
): string[] {
  const at = pins.indexOf(id);
  if (at === -1) return step < 0 ? [...pins, id] : [...pins];
  let to = at + step;
  while (to >= 0 && to < pins.length && !shown.has(pins[to] ?? "")) to += step;
  if (to < 0) return [...pins];
  const rest = pins.filter((p) => p !== id);
  if (to >= pins.length) return step > 0 ? rest : [...pins];
  const next = rest.indexOf(pins[to] ?? "") + (step > 0 ? 1 : 0);
  return [...rest.slice(0, next), id, ...rest.slice(next)];
}
