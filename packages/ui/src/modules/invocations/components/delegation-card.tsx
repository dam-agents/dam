import { Bot, Chat, StopFilledAlt } from "@carbon/icons-react";
import {
  type DelegationNode,
  delegationTitle,
  type TurnSummary,
} from "api-server-api";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { DisclosureChevron } from "@/components/ui/disclosure";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { useStore } from "../../../store.js";
import type { AgentState } from "../../../types.js";
import { ToolContentBlock } from "../../sessions/components/tool-chip.js";
import { useTurnSpend } from "../../spend/api/queries.js";
import { TurnTelemetry } from "../../telemetry/components/turn-telemetry.js";
import { useStopDelegation } from "../api/mutations.js";
import {
  type DelegationModel,
  delegationModel,
  delegationState,
} from "../lib/delegation-state.js";
import { DelegationStatePill } from "./delegation-state-pill.js";

interface Props {
  node: DelegationNode;
  driverAgentId: string;
  agentStates: ReadonlyMap<string, AgentState>;
  turns: Readonly<Record<string, TurnSummary>> | undefined;
}

function subtitle(node: DelegationNode): string {
  const parts = ["Temporary agent", node.templateId ?? node.image];
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
  const spendTurns = useMemo(() => (turn ? [turn] : []), [turn]);
  const { data: turnSpend } = useTurnSpend(node.id, null, spendTurns);
  const model = delegationModel(node.requestedModel, turn?.models);

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
            {delegationTitle(node)}
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

      <ModelLine model={model} />
      {turn && (
        <TurnTelemetry
          agentId={driverAgentId}
          invocationId={node.id}
          turn={turn}
          spend={turnSpend?.get(turn.turnId)}
          className="-mt-1 mb-1.5"
          triggerClassName="ml-[58px]"
        />
      )}

      {open && (
        <div className="-mx-3 flex flex-col gap-2.5 border-t border-border/40 px-3 py-2.5">
          {node.script === null ? (
            <Field label="Prompt">
              <ToolContentBlock text={node.prompt} />
            </Field>
          ) : (
            <Field label="Script">
              <ToolContentBlock text={node.script} />
            </Field>
          )}
          {node.exitCode !== null && (
            <Field label="Exit code">
              <ToolContentBlock text={String(node.exitCode)} />
            </Field>
          )}
          {node.status === "done" && node.script === null && (
            <Field label="Result">
              <ToolContentBlock text={JSON.stringify(node.result, null, 2)} />
            </Field>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {node.script === null && (
              <OpenConversation node={node} driverAgentId={driverAgentId} />
            )}
            {node.status === "running" && (
              <StopDelegation node={node} driverAgentId={driverAgentId} />
            )}
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

function StopDelegation({
  node,
  driverAgentId,
}: {
  node: DelegationNode;
  driverAgentId: string;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const stop = useStopDelegation();
  return (
    <Button
      variant="destructive"
      size="xs"
      disabled={stop.isPending}
      onClick={async () => {
        const ok = await showConfirm(
          "The agent is removed and the driver gets a failed result.",
          "Stop this temporary agent?",
          { kind: "destructive", confirmLabel: "Stop agent" },
        );
        if (ok) stop.mutate({ driverAgentId, id: node.id });
      }}
    >
      <StopFilledAlt size={14} /> Stop
    </Button>
  );
}

function OpenConversation({
  node,
  driverAgentId,
}: {
  node: DelegationNode;
  driverAgentId: string;
}) {
  const setDock = useStore((s) => s.setDock);
  const confirmDiscard = useDockDraftGuard();
  const blocked =
    node.status === "running"
      ? "The conversation opens once the agent reports"
      : node.transcriptAvailable
        ? null
        : "Conversation was not captured";
  const button = (
    <Button
      variant="outline"
      size="xs"
      disabled={blocked !== null}
      onClick={async () => {
        if (!(await confirmDiscard())) return;
        setDock({ kind: "delegation", driverAgentId, id: node.id });
      }}
    >
      <Chat size={14} /> Open conversation
    </Button>
  );
  return blocked ? (
    <Tooltip content={blocked} side="top">
      <span className="inline-flex">{button}</span>
    </Tooltip>
  ) : (
    button
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-2xs text-placeholder">{label}</div>
      {children}
    </div>
  );
}

const SUBSTITUTED =
  "The sub-agent ran another model than the one its driver asked for.";

function ModelLine({ model }: { model: DelegationModel }) {
  if (model.ran === null && model.requested === null) return null;
  const asked =
    model.requested === null
      ? null
      : `${model.ran === null ? "Asked" : " · asked"} for ${model.requested}`;
  return (
    <p
      data-testid="delegation-model"
      className="-mt-1 mb-1.5 ml-[58px] truncate text-xs text-muted-foreground"
    >
      {model.ran !== null && <>Model {model.ran}</>}
      {asked !== null &&
        (model.substituted ? (
          <Tooltip content={SUBSTITUTED} side="top">
            <span tabIndex={0} className="text-warning">
              {asked}
              <span className="sr-only">. {SUBSTITUTED}</span>
            </span>
          </Tooltip>
        ) : (
          asked
        ))}
    </p>
  );
}
