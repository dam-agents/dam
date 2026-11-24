import { WarningAlt } from "@carbon/icons-react";
import type { ToolMode } from "api-server-api";

import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group";

import { ALLOW_ALL_WARNING, toolModeCopy } from "../lib/tool-mode.js";

interface Props {
  value: ToolMode;
  onChange: (value: ToolMode) => void;
  modes: readonly ToolMode[];
  ownNames: boolean;
  testIdPrefix: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the one place the owner picks what agents may do with the tools of an MCP connection, one card per mode it offers. Allow all is its own card in the danger tone with a warning, so letting an agent act as the owner is always a choice someone made.
export function ToolModeField({
  value,
  onChange,
  modes,
  ownNames,
  testIdPrefix,
}: Props) {
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => {
        const mode = modes.find((m) => m === next);
        if (mode) onChange(mode);
      }}
      aria-label="What agents can do with this connection"
      className="gap-3"
    >
      {modes.map((mode) => {
        const copy = toolModeCopy(mode, ownNames);
        const allowsAll = mode === "allow-all";
        return (
          <RadioGroupCard
            key={mode}
            value={mode}
            tone={allowsAll ? "danger" : "default"}
            label={copy.label}
            description={copy.description}
            testId={`${testIdPrefix}-${mode}`}
          >
            {allowsAll && value === "allow-all" ? (
              <p className="flex gap-2 text-sm text-danger">
                <WarningAlt size={16} className="mt-0.5 shrink-0" aria-hidden />
                {ALLOW_ALL_WARNING}
              </p>
            ) : null}
          </RadioGroupCard>
        );
      })}
    </RadioGroup>
  );
}
