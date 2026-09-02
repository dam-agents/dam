import { rruleToText } from "api-server-api";

import type { Message } from "../../../types.js";
import type { Pack, PackSlot } from "../data/packs.js";

export function buildPackSummaryMessage(
  pack: Pack,
  connectedSlots: PackSlot[],
  missingSlots: PackSlot[],
): Message {
  const lines: string[] = [pack.description, ""];

  const skills = pack.included.filter((s) => s.kind === "skill");
  const schedules = [...pack.included, ...pack.required].filter(
    (s) => s.kind === "schedule",
  );

  if (connectedSlots.length > 0) {
    lines.push(
      `**Connected:** ${connectedSlots.map((s) => s.label).join(", ")}`,
    );
  }
  if (skills.length > 0) {
    lines.push(`**Installed:** ${skills.map((s) => s.label).join(", ")}`);
  }
  if (schedules.length > 0) {
    lines.push(
      `**Scheduled:** ${schedules.map((s) => formatScheduleLabel(s)).join(", ")}`,
    );
  }

  if (missingSlots.length > 0) {
    lines.push("");
    lines.push("**Still need:**");
    for (const slot of missingSlots) {
      lines.push(
        `- ${slot.label} (${slot.kind.replace("-", " ")}) — add it in Settings > Setup`,
      );
    }
  }

  return {
    id: `pack-summary-${Date.now()}`,
    role: "assistant",
    streaming: false,
    parts: [{ kind: "text", text: lines.join("\n") }],
  };
}

function formatScheduleLabel(slot: PackSlot): string {
  if (!slot.demoValue) return slot.label;
  if (slot.demoValue.startsWith("RRULE:")) {
    return `${slot.label} (${rruleToText(slot.demoValue)})`;
  }
  return `${slot.label} (${slot.demoValue})`;
}
