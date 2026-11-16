import { ChevronDown } from "@carbon/icons-react";
import {
  agentToolApprovalSetting,
  approvalOption,
  type HarnessCapability,
  type ToolApproval,
  toolApprovalChoices,
} from "agent-runtime-api";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const LABELS: Record<ToolApproval, string> = {
  ask: "Always ask",
  auto: "Auto mode",
  bypass: "Bypass",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: one session's tool approval, as the choices its
 * harness offers. A harness with neither an approvals option nor a mode that
 * bypasses (Pi, Codex) runs every tool unasked. Plan modes are never offered,
 * and a harness with one choice or none shows no picker. A pick is the
 * session's alone; with none, a session runs on the agent's own tool
 * approval, and on Auto mode where the agent holds none.
 */
export function ToolApprovalPicker({
  capability,
  settings,
  agentApproval,
  onChange,
}: {
  capability: HarnessCapability | undefined;
  /* UNIT_BOUNDARY_DESCRIPTION: the session's own settings, never a default's. */
  settings: Readonly<Record<string, string>>;
  agentApproval?: ToolApproval | null | undefined;
  onChange: (changes: Record<string, string>) => void;
}) {
  const option = approvalOption(capability?.harnessConfigCatalog);
  const offered = toolApprovalChoices(capability?.harnessConfigCatalog);
  const choices = offered.map((c) => ({
    label: LABELS[c.approval],
    value: c.value,
  }));
  if (!option || choices.length < 2) return null;
  const current =
    settings[option.id] ??
    agentToolApprovalSetting(capability?.harnessConfigCatalog, agentApproval, {
      model: null,
      unattended: false,
    })?.value ??
    offered.find((c) => c.approval === "auto")?.value ??
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
