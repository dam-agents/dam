export interface PinnedKitRef {
  catalog: string;
  kitId: string;
}

export function parsePinnedKit(pin: string): PinnedKitRef | null {
  const [catalog, kitId, ...extra] = pin.split("/");
  if (!catalog || !kitId || extra.length > 0) return null;
  return { catalog, kitId };
}

export function isPinnedKit(
  pin: PinnedKitRef | null,
  catalog: string,
  kitId: string,
): boolean {
  return pin !== null && pin.catalog === catalog && pin.kitId === kitId;
}
