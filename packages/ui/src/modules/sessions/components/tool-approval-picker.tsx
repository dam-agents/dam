import { ChevronDown } from "@carbon/icons-react";
import type { HarnessCapability } from "agent-runtime-api";

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
 * option and has no Bypass. A harness with neither (Pi, Codex, Copilot) runs
 * every tool unasked, so it offers Bypass alone. Plan modes are never offered.
 */
const APPROVALS = [
  { label: "Always ask", values: ["acceptEdits", "ask"] },
  { label: "Auto mode", values: ["auto"] },
  { label: "Bypass", values: ["bypassPermissions"] },
] as const;

/** UNIT_BOUNDARY_DESCRIPTION: the harness option that holds tool approval, if it has one. */
export function approvalOption(capability: HarnessCapability | undefined) {
  const options = capability?.harnessConfigCatalog?.options ?? [];
  return (
    options.find((o) => o.category === "approvals") ??
    options.find(
      (o) =>
        o.category === "mode" &&
        o.choices.some((c) => c.value === "bypassPermissions"),
    )
  );
}

export function ToolApprovalPicker({
  capability,
  settings,
  onChange,
}: {
  capability: HarnessCapability | undefined;
  settings: Readonly<Record<string, string>>;
  onChange: (changes: Record<string, string>) => void;
}) {
  const option = approvalOption(capability);
  const choices = APPROVALS.flatMap(({ label, values }) => {
    const choice = option?.choices.find((c) =>
      (values as readonly string[]).includes(c.value),
    );
    return choice ? [{ label, value: choice.value }] : [];
  });
  const current = option && (settings[option.id] ?? option.default);
  const label =
    option === undefined
      ? "Bypass"
      : (choices.find((c) => c.value === current)?.label ??
        option.choices.find((c) => c.value === current)?.name ??
        "Tool approval");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={choices.length < 2}>
        <button
          type="button"
          aria-label={`Tool approval: ${label}`}
          data-testid="tool-approval-picker"
          className="flex shrink-0 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none"
        >
          {label}
          {choices.length > 1 && <ChevronDown size={12} aria-hidden />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={current ?? ""}
          onValueChange={(next) => option && onChange({ [option.id]: next })}
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
