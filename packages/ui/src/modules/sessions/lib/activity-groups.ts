import { toolNameOf } from "agent-runtime-api";

import type { MessagePart, ToolChip } from "../../../types.js";

export type ActivityItem =
  | { kind: "part"; part: MessagePart; index: number }
  | { kind: "group"; chips: ToolChip[]; index: number };

export function activityItems(
  parts: readonly MessagePart[],
  standalone: (chip: ToolChip) => boolean,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  let group: ToolChip[] | null = null;
  for (const [index, part] of parts.entries()) {
    if (part.kind === "tool" && !standalone(part)) {
      if (group) {
        group.push(part);
      } else {
        group = [part];
        items.push({ kind: "group", chips: group, index });
      }
      continue;
    }
    group = null;
    items.push({ kind: "part", part, index });
  }
  return items;
}

const RUNNING = new Set(["pending", "in_progress", "running"]);

export function runningChip(
  chips: readonly ToolChip[],
): { chip: ToolChip; step: number } | undefined {
  for (let i = chips.length - 1; i >= 0; i--) {
    if (RUNNING.has(chips[i].status)) return { chip: chips[i], step: i + 1 };
  }
  return undefined;
}

type Phrase = (n: number) => string;

const plural =
  (verb: string, noun: string): Phrase =>
  (n) =>
    `${verb} ${n} ${noun}${n === 1 ? "" : "s"}`;

const times =
  (verb: string): Phrase =>
  (n) =>
    n === 1 ? `${verb} once` : `${verb} ${n} times`;

const KIND_PHRASES: Record<string, Phrase> = {
  execute: plural("ran", "command"),
  read: plural("read", "file"),
  edit: plural("edited", "file"),
  delete: plural("deleted", "file"),
  move: plural("moved", "file"),
  search: times("searched"),
  fetch: plural("fetched", "page"),
  think: times("thought"),
  switch_mode: (n) => (n === 1 ? "switched mode" : `switched mode ${n} times`),
};

const OTHER = "other";
const otherPhrase = plural("used", "tool");

function namesServerTool(chip: ToolChip): boolean {
  return toolNameOf(chip.title) !== chip.title.trim();
}

export function kindSummary(chips: readonly ToolChip[]): string {
  const counts = new Map<string, number>();
  for (const chip of chips) {
    const kind =
      chip.toolKind && chip.toolKind in KIND_PHRASES && !namesServerTool(chip)
        ? chip.toolKind
        : OTHER;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  const text = [...counts]
    .map(([kind, n]) => (KIND_PHRASES[kind] ?? otherPhrase)(n))
    .join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function groupLabel(chips: readonly ToolChip[]): string {
  if (chips.length === 1 && chips[0].description) return chips[0].description;
  return kindSummary(chips);
}
