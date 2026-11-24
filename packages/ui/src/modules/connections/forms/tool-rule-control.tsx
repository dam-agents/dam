import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import type { ToolRule } from "api-server-api";

import { cn } from "@/lib/utils";

import { TOOL_RULES } from "../lib/grant-tool-access.js";

const RULE_LABEL: Record<ToolRule, string> = {
  allow: "Allow",
  ask: "Ask",
  block: "Block",
};

const RULE_DOT: Record<ToolRule, string> = {
  allow: "bg-success",
  ask: "bg-warning",
  block: "bg-danger",
};

interface Props {
  value: ToolRule;
  onChange: (rule: ToolRule) => void;
  label: string;
  quiet?: boolean;
  testId?: string;
}

// UNIT_BOUNDARY_DESCRIPTION: the Allow, Ask or Block choice for a group of tools or for one tool, as one row of three. A quiet control is a tool that only follows its group, so its choice does not stand out from the group's.
export function ToolRuleControl({
  value,
  onChange,
  label,
  quiet = false,
  testId,
}: Props) {
  return (
    <RadioGroupPrimitive.Root
      value={value}
      onValueChange={(next) => {
        const rule = TOOL_RULES.find((r) => r === next);
        if (rule) onChange(rule);
      }}
      orientation="horizontal"
      aria-label={label}
      data-testid={testId}
      className="inline-flex shrink-0 gap-0.5 rounded-lg bg-muted p-0.5"
    >
      {TOOL_RULES.map((rule) => (
        <RadioGroupPrimitive.Item
          key={rule}
          value={rule}
          data-testid={testId && `${testId}-${rule}`}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-muted-foreground ring-offset-background transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "data-[state=checked]:text-foreground",
            !quiet &&
              "data-[state=checked]:bg-card data-[state=checked]:ring-1 data-[state=checked]:ring-border",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 rounded-full opacity-35",
              RULE_DOT[rule],
              value === rule && "opacity-100",
            )}
          />
          {RULE_LABEL[rule]}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
