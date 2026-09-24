import type { ToolChip } from "../../../types.js";

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
