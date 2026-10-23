import { formatGi } from "../../../lib/format-size.js";
import { parseCpuMilli, parseMemoryMi } from "../../sandboxes/lib/quantity.js";
import { formatCores } from "./format.js";

export const BYTES_PER_MI = 1024 ** 2;

export interface SizeMi {
  cpuMilli: number;
  memoryMi: number;
}

export function sizeInMi(size: { cpu?: string; memory?: string }): SizeMi {
  return {
    cpuMilli: parseCpuMilli(size.cpu) ?? 0,
    memoryMi: parseMemoryMi(size.memory) ?? 0,
  };
}

export function formatCpuMemory(size: SizeMi): string {
  return `${formatCores(size.cpuMilli)} CPU · ${formatGi(
    size.memoryMi * BYTES_PER_MI,
  )} GiB`;
}
