import { SIDEBAR_ORDER_MAX } from "api-server-api";

export interface OrderDrop {
  id: string;
  after: boolean;
}

function createdAt(value: string | null | undefined): number {
  const at = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at;
}

export function manualOrder<T>(
  items: readonly T[],
  order: readonly string[],
  idOf: (item: T) => string,
  createdAtOf: (item: T) => string | null | undefined,
): T[] {
  const rank = new Map(order.map((id, at) => [id, at]));
  const ranked = items.filter((item) => rank.has(idOf(item)));
  const rest = items.filter((item) => !rank.has(idOf(item)));
  ranked.sort((a, b) => rank.get(idOf(a))! - rank.get(idOf(b))!);
  rest.sort((a, b) => {
    const [atA, atB] = [createdAt(createdAtOf(a)), createdAt(createdAtOf(b))];
    if (atA !== atB) return atA < atB ? -1 : 1;
    const [idA, idB] = [idOf(a), idOf(b)];
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
  return [...ranked, ...rest];
}

function capped(order: string[], shown: ReadonlySet<string>): string[] {
  let over = order.length - SIDEBAR_ORDER_MAX;
  if (over <= 0) return order;
  const kept = [...order];
  for (let at = kept.length - 1; at >= 0 && over > 0; at--) {
    if (shown.has(kept[at]!)) continue;
    kept.splice(at, 1);
    over--;
  }
  return kept.slice(0, SIDEBAR_ORDER_MAX);
}

export function orderAfterMove(
  order: readonly string[],
  shown: readonly string[],
  id: string,
  drop: OrderDrop,
): string[] | null {
  if (drop.id === id) return null;
  const stored = new Set(order);
  const all = [...order, ...shown.filter((item) => !stored.has(item))];
  if (!all.includes(id) || !all.includes(drop.id)) return null;
  const rest = all.filter((item) => item !== id);
  const at = rest.indexOf(drop.id) + (drop.after ? 1 : 0);
  return capped([...rest.slice(0, at), id, ...rest.slice(at)], new Set(shown));
}

export function orderAfterStep(
  order: readonly string[],
  shown: readonly string[],
  id: string,
  step: -1 | 1,
): string[] | null {
  const at = shown.indexOf(id);
  const neighbour = shown[at + step];
  if (at === -1 || neighbour === undefined) return null;
  return orderAfterMove(order, shown, id, { id: neighbour, after: step > 0 });
}
