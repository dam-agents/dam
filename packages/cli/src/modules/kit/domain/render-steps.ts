import { printable } from "../../shared/printable.js";
import type { KitStep } from "./kit-plan.js";

export function renderSteps(steps: readonly KitStep[]): string {
  const open = steps.filter((s) => s.done !== true);
  if (open.length === 0) return "Nothing is left to set up.\n";
  const lines = ["", "Left to set up:"];
  for (const step of steps) {
    const mark = step.done === null ? "[?]" : step.done ? "[x]" : "[ ]";
    const need = step.required ? "required" : "suggested";
    lines.push(
      `  ${mark} ${step.kind}: ${printable(step.what)} (${need})${step.note ? ` — ${printable(step.note)}` : ""}`,
    );
    if (step.done !== true) lines.push(`      ${printable(step.command)}`);
  }
  return `${lines.join("\n")}\n`;
}
