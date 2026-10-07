import type { Message, ToolChip } from "../../../types.js";

export interface FanOutSpawn {
  id: string;
  label: string;
}

const SPAWN_LINES = [
  /^(?:\d+\t)?\[invoke\] spawned (?<label>.+?) -> (?<id>agent-[a-z0-9]+)$/,
  /^(?:\d+\t)?\[invoke\] spawned (?<label>.+?) \((?<id>agent-[a-z0-9]+)\)$/,
];

const parsed = new WeakMap<ToolChip, FanOutSpawn[] | null>();

export function parseFanOut(chip: ToolChip): FanOutSpawn[] | null {
  const cached = parsed.get(chip);
  if (cached !== undefined) return cached;
  const spawns = scanSpawns(chip);
  parsed.set(chip, spawns);
  return spawns;
}

function scanSpawns(chip: ToolChip): FanOutSpawn[] | null {
  const spawns = new Map<string, FanOutSpawn>();
  for (const block of chip.content ?? []) {
    for (const line of (block.text ?? "").split("\n")) {
      const trimmed = line.trim();
      const match = SPAWN_LINES.map((re) => re.exec(trimmed)).find(Boolean);
      const id = match?.groups?.id;
      const label = match?.groups?.label;
      if (id && label && !spawns.has(id)) spawns.set(id, { id, label });
    }
  }
  return spawns.size > 0 ? [...spawns.values()] : null;
}

export type ChipKey = string | ToolChip;

export function chipKeyOf(chip: ToolChip): ChipKey {
  return chip.toolCallId ?? chip;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: for every child the transcript accounts for, the
 * key of the first chip that names it. A driver can print or read back the same progress
 * lines more than once, so only that chip shows the child. Until any chip
 * names a child the live block speaks for it; this map is what hands it over,
 * in the render the chip lands rather than whenever a poll next runs.
 */
export function fanOutOwners(
  messages: readonly Message[],
): ReadonlyMap<string, ChipKey> {
  const owners = new Map<string, ChipKey>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.kind !== "tool") continue;
      for (const spawn of parseFanOut(part) ?? []) {
        if (!owners.has(spawn.id)) owners.set(spawn.id, chipKeyOf(part));
      }
    }
  }
  return owners;
}
