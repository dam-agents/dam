import type { GrantToolAccess, ToolRule } from "api-server-api";
import { useState } from "react";
import { match } from "ts-pattern";

import { Badge } from "@/components/ui/badge";
import { DisclosureToggle } from "@/components/ui/disclosure";

import { ToolRuleControl } from "../forms/tool-rule-control.js";
import {
  exceptionsOf,
  type ListedTools,
  TOOL_GROUP_TITLE,
  type ToolGroup,
  toolRuleOf,
  toolsOfGroup,
  withGroupRule,
  withoutException,
  withToolRule,
} from "../lib/grant-tool-access.js";
import { ToolRuleRow } from "./tool-rule-row.js";

function exceptionWord(rule: ToolRule): string {
  return match(rule)
    .with("allow", () => "allowed")
    .with("ask", () => "asks")
    .with("block", () => "blocked")
    .exhaustive();
}

function exceptionsLine(
  exceptions: readonly { name: string; rule: ToolRule }[],
): string | null {
  if (exceptions.length === 0) return null;
  const count = `${exceptions.length} ${exceptions.length === 1 ? "exception" : "exceptions"}`;
  const named = exceptions
    .map(({ name, rule }) => `${name} ${exceptionWord(rule)}`)
    .join(", ");
  return `${count}: ${named}`;
}

interface Props {
  group: ToolGroup;
  access: GrantToolAccess;
  tools: ListedTools;
  onChange: (next: GrantToolAccess) => void;
  defaultOpen?: boolean;
}

// UNIT_BOUNDARY_DESCRIPTION: one group of an MCP connection's tools in the tool access dialog: its Allow, Ask or Block rule and how many tools it holds. Opened, it lists each tool with its own rule; a tool that differs from its group is an exception with a reset, and a closed group names its exceptions. The write group also lists every tool with its own rule that the tool list does not name, so no rule the gateway applies is hidden.
export function ToolRuleGroup({
  group,
  access,
  tools,
  onChange,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const title = TOOL_GROUP_TITLE[group];
  const groupTools = toolsOfGroup(access, tools, group);
  const exceptions = exceptionsOf(access, group, tools);
  const exceptionNames = new Set(exceptions.map((e) => e.name));
  const line = exceptionsLine(exceptions);
  return (
    <div
      className="rounded-lg border border-border"
      data-testid={`tool-group-${group}`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <div className="min-w-0 flex-[1_1_200px]">
          <DisclosureToggle
            open={open}
            onToggle={() => setOpen((was) => !was)}
            chevronClassName="text-muted-foreground"
            testId={`tool-group-${group}-toggle`}
            className="rounded-sm text-sm font-semibold text-foreground"
          >
            {title}
            <Badge variant="muted" size="sm" className="font-mono">
              {groupTools.length}
            </Badge>
          </DisclosureToggle>
          {line && (
            <p
              className="mt-0.5 break-words pl-6 text-xs text-muted-foreground"
              data-testid={`tool-group-${group}-exceptions`}
            >
              {line}
            </p>
          )}
        </div>
        <ToolRuleControl
          value={access[group]}
          onChange={(rule) =>
            onChange(withGroupRule(access, group, rule, tools))
          }
          label={title}
          testId={`tool-group-${group}-rule`}
        />
      </div>
      {open && groupTools.length > 0 && (
        <ul className="divide-y divide-border-hairline border-t border-border-hairline px-3">
          {groupTools.map(({ name, listed }) => (
            <ToolRuleRow
              key={name}
              name={name}
              listed={listed}
              rule={toolRuleOf(access, name, tools)}
              exception={exceptionNames.has(name)}
              onChange={(rule) =>
                onChange(withToolRule(access, name, rule, tools))
              }
              onReset={() => onChange(withoutException(access, name))}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
