import { ChevronDown } from "@carbon/icons-react";
import {
  approvalOption,
  COPILOT_AUTOPILOT,
  type HarnessCapability,
} from "agent-runtime-api";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the harness value each tool-approval choice
 * stands for. Claude Code keeps approval in its permission mode, where Always
 * ask is Accept edits (edits never prompt); Bob keeps it in its approvals
 * option and has no Bypass; Copilot's Autopilot is its Auto mode. A harness
 * with neither (Pi, Codex) runs every tool unasked. Plan modes are never
 * offered, and a harness with one choice or none shows no picker. A pick is
 * the session's alone; with none, a session runs on Auto mode.
 */
const APPROVALS = [
  { label: "Always ask", values: ["acceptEdits", "ask"] },
  { label: "Auto mode", values: ["auto", COPILOT_AUTOPILOT] },
  { label: "Bypass", values: ["bypassPermissions"] },
] as const;

export function ToolApprovalPicker({
  capability,
  settings,
  onChange,
}: {
  capability: HarnessCapability | undefined;
  /* UNIT_BOUNDARY_DESCRIPTION: the session's own settings, never a default's. */
  settings: Readonly<Record<string, string>>;
  onChange: (changes: Record<string, string>) => void;
}) {
  const option = approvalOption(capability?.harnessConfigCatalog);
  const choices = APPROVALS.flatMap(({ label, values }) => {
    const choice = option?.choices.find((c) =>
      (values as readonly string[]).includes(c.value),
    );
    return choice ? [{ label, value: choice.value }] : [];
  });
  if (!option || choices.length < 2) return null;
  const current =
    settings[option.id] ??
    choices.find((c) => c.label === "Auto mode")?.value ??
    option.default;
  const label =
    choices.find((c) => c.value === current)?.label ??
    option.choices.find((c) => c.value === current)?.name ??
    "Tool approval";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Tool approval: ${label}`}
          data-testid="tool-approval-picker"
          className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {label}
          <ChevronDown size={12} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={current ?? ""}
          onValueChange={(next) => onChange({ [option.id]: next })}
        >
          {choices.map((c) => (
            <DropdownMenuRadioItem key={c.value} value={c.value}>
              {c.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
