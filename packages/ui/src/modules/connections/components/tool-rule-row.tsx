import type { ToolRule } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { ToolRuleControl } from "../forms/tool-rule-control.js";

interface Props {
  name: string;
  listed: boolean;
  rule: ToolRule;
  exception: boolean;
  onChange: (rule: ToolRule) => void;
  onReset: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: one tool in the tool access dialog with its Allow, Ask or Block control. A tool with its own rule that the tool list does not name is marked as such and can always be reset, because its rule holds at the gateway even though the list does not show the tool.
export function ToolRuleRow({
  name,
  listed,
  rule,
  exception,
  onChange,
  onReset,
}: Props) {
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-1.5"
      data-testid={`tool-rule-${name}`}
      data-exception={exception ? "true" : undefined}
    >
      <span className="flex min-w-0 flex-[1_1_180px] flex-wrap items-center gap-2 break-all font-mono text-xs text-foreground">
        {name}
        {!listed && (
          <Badge
            variant="warning"
            size="sm"
            className="font-sans"
            data-testid={`tool-rule-${name}-unlisted`}
          >
            not in the tool list
          </Badge>
        )}
        {exception && (
          <Badge variant="accent" size="sm" className="font-sans">
            exception
          </Badge>
        )}
        {(exception || !listed) && (
          <Button
            variant="link"
            size="inline"
            tone="muted"
            className="font-sans text-xs"
            onClick={onReset}
            aria-label={`Reset ${name}`}
            data-testid={`tool-rule-${name}-reset`}
          >
            Reset
          </Button>
        )}
      </span>
      <ToolRuleControl
        value={rule}
        onChange={onChange}
        label={name}
        quiet={!exception}
        testId={`tool-rule-${name}-rule`}
      />
    </li>
  );
}
