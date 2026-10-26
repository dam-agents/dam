import { createContext, useContext, useMemo, useRef } from "react";

import type { Message, ToolChip } from "../../../types.js";
import {
  type ChipKey,
  chipKeyOf,
  fanOutOwners,
  type FanOutSpawn,
  parseFanOut,
} from "../lib/fan-out.js";

type Owners = ReadonlyMap<string, ChipKey>;

const DelegationOwnersContext = createContext<Owners | null>(null);

export const DelegationOwnersProvider = DelegationOwnersContext.Provider;

function sameOwners(a: Owners, b: Owners): boolean {
  if (a.size !== b.size) return false;
  for (const [id, key] of a) if (b.get(id) !== key) return false;
  return true;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the owners map keeps its identity while no chip
 * gains or loses a child, so a streamed chunk does not re-render every tool
 * chip in the conversation.
 */
export function useDelegationOwners(messages: readonly Message[]): Owners {
  const previous = useRef<Owners>(new Map());
  return useMemo(() => {
    const next = fanOutOwners(messages);
    if (sameOwners(previous.current, next)) return previous.current;
    previous.current = next;
    return next;
  }, [messages]);
}

export function useOwnedSpawns(chip: ToolChip): FanOutSpawn[] | null {
  const owners = useContext(DelegationOwnersContext);
  const spawns = parseFanOut(chip);
  if (!spawns || !owners) return spawns;
  const key = chipKeyOf(chip);
  const owned = spawns.filter((spawn) => owners.get(spawn.id) === key);
  return owned.length > 0 ? owned : null;
}
