import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ConnectionIcon } from "@/modules/connections/components/connection-icon";

import type { Pack, PackIngredientKind } from "../data/packs.js";

interface Chip {
  key: string;
  label: string;
  icon?: ReactNode;
  order: number;
}

const KIND_ORDER: Partial<Record<PackIngredientKind, number>> = {
  schedule: 0,
  channel: 1,
  connection: 2,
  "knowledge-base": 3,
  skill: 4,
};

function collectChips(pack: Pack): Chip[] {
  const chips: Chip[] = [];
  const countByKind = new Map<PackIngredientKind, number>();

  for (const slot of [...pack.included, ...pack.required]) {
    const order = KIND_ORDER[slot.kind];
    if (order === undefined) continue;

    if (slot.kind === "connection") {
      chips.push({
        key: `connection-${slot.templateId ?? slot.label}`,
        label: slot.label,
        icon: (
          <ConnectionIcon iconSlug={slot.templateId} alt="" size={16} />
        ),
        order: order + chips.length * 0.001,
      });
    } else if (slot.kind === "channel") {
      chips.push({
        key: `channel-${slot.label}`,
        label: "Slack",
        icon: <ConnectionIcon iconSlug="slack" alt="" size={16} />,
        order: order + chips.length * 0.001,
      });
    } else {
      countByKind.set(slot.kind, (countByKind.get(slot.kind) ?? 0) + 1);
    }
  }

  for (const [kind, count] of countByKind) {
    const base = KIND_ORDER[kind]!;
    const label = KIND_LABELS[kind] ?? kind;
    const plural =
      count > 1 && kind !== "knowledge-base" ? `${label}s` : label;
    chips.push({
      key: kind,
      label: `${count} ${plural}`,
      order: base,
    });
  }

  const seen = new Set<string>();
  return chips
    .filter((c) => {
      const dedup = `${c.label}`;
      if (seen.has(dedup)) return false;
      seen.add(dedup);
      return true;
    })
    .sort((a, b) => a.order - b.order);
}

const KIND_LABELS: Partial<Record<PackIngredientKind, string>> = {
  schedule: "Schedule",
  "knowledge-base": "Knowledge base",
  skill: "Skill",
};

export function PackIngredientSummary({
  pack,
  className,
}: {
  pack: Pack;
  className?: string;
}) {
  const chips = collectChips(pack);
  if (chips.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {chips.map((chip) => (
        <Badge
          key={chip.key}
          variant="muted"
          className={chip.icon ? "gap-1.5" : undefined}
        >
          {chip.icon}
          {chip.label}
        </Badge>
      ))}
    </div>
  );
}
