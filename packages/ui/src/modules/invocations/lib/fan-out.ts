import type { Message, ToolChip } from "../../../types.js";

export interface FanOutSpawn {
  id: string;
  label: string;
}

const SPAWN_LINE =
  /^\[invoke\] spawned (?<label>.+?) -> (?<id>agent-[a-z0-9]+)$/;

export function parseFanOut(chip: ToolChip): FanOutSpawn[] | null {
  const spawns = new Map<string, FanOutSpawn>();
  for (const block of chip.content ?? []) {
    for (const line of (block.text ?? "").split("\n")) {
      const match = SPAWN_LINE.exec(line.trim());
      const id = match?.groups?.id;
      const label = match?.groups?.label;
      if (id && label && !spawns.has(id)) spawns.set(id, { id, label });
    }
  }
  return spawns.size > 0 ? [...spawns.values()] : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: every child the transcript already accounts for.
 * A fan-out's chip arrives only once the driver's script exits, so until then
 * the live block speaks for those children; this set is what hands them over,
 * in the render the chip lands rather than whenever a poll next runs.
 */
export function fanOutIdsIn(messages: readonly Message[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.kind !== "tool") continue;
      for (const spawn of parseFanOut(part) ?? []) ids.add(spawn.id);
    }
  }
  return ids;
}
