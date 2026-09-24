import { Bot, Chat } from "@carbon/icons-react";
import type { DelegationNode, TurnSummary } from "api-server-api";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { DisclosureChevron } from "@/components/ui/disclosure";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import type { AgentState } from "../../../types.js";
import { ToolContentBlock } from "../../sessions/components/tool-chip.js";
import { TurnTelemetry } from "../../telemetry/components/turn-telemetry.js";
import { delegationState, firstLine } from "../lib/delegation-state.js";
import { DelegationStatePill } from "./delegation-state-pill.js";

interface Props {
  node: DelegationNode;
  driverAgentId: string;
  agentStates: ReadonlyMap<string, AgentState>;
  turns: Readonly<Record<string, TurnSummary>> | undefined;
}

function subtitle(node: DelegationNode): string {
  const parts = ["Temporary agent", node.templateId ?? node.image];
  if (node.cpu) parts.push(`${node.cpu} CPU`);
  if (node.memory) parts.push(node.memory);
  return parts.filter((p): p is string => !!p).join(" · ");
}

export function DelegationCard({
  node,
  driverAgentId,
  agentStates,
  turns,
}: Props) {
  const [open, setOpen] = useState(false);
  const state = delegationState(node, agentStates.get(node.id));
  const failed = state === "failed";
  const turn = turns?.[node.id];

  return (
    <div className={cn(CARD_SURFACE, "border-border px-3 mt-2")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 min-h-[52px] py-1.5 text-left"
      >
        <DisclosureChevron open={open} size={12} className="shrink-0" />
        <span
          aria-hidden
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-accent-light text-accent"
        >
          <Bot size={15} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className="truncate text-sm font-medium text-foreground"
            title={node.prompt}
          >
            {firstLine(node.prompt)}
          </span>
          <span
            className={cn(
              "truncate text-xs",
              failed ? "text-danger" : "text-muted-foreground",
            )}
          >
            {failed && node.errorReason ? node.errorReason : subtitle(node)}
          </span>
        </span>
        <DelegationStatePill state={state} />
      </button>

      {turn && (
        <TurnTelemetry
          agentId={driverAgentId}
          invocationId={node.id}
          turn={turn}
          className="-mt-1 mb-1.5"
          triggerClassName="ml-[58px]"
        />
      )}

      {open && (
        <div className="-mx-3 flex flex-col gap-2.5 border-t border-border/40 px-3 py-2.5">
          <Field label="Prompt">
            <ToolContentBlock text={node.prompt} />
          </Field>
          {node.status === "done" && (
            <Field label="Result">
              <ToolContentBlock text={JSON.stringify(node.result, null, 2)} />
            </Field>
          )}
          <div>
            <Tooltip
              content="Opens with the child view (coming next)"
              side="top"
            >
              <span className="inline-flex">
                <Button variant="outline" size="xs" disabled>
                  <Chat size={14} /> Open conversation
                </Button>
              </span>
            </Tooltip>
          </div>
          {node.children.map((child) => (
            <DelegationCard
              key={child.id}
              node={child}
              driverAgentId={driverAgentId}
              agentStates={agentStates}
              turns={turns}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] text-placeholder">{label}</div>
      {children}
    </div>
  );
}
