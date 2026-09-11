import { useStore } from "../../../store.js";
import { PACKS, REAL_PACKS } from "../data/packs.js";

export function usePacks() {
  const real = useStore((s) => s.realPacks);
  return real ? REAL_PACKS : PACKS;
}

export function getActivePacks() {
  return useStore.getState().realPacks ? REAL_PACKS : PACKS;
}
