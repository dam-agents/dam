import { Bot, Chat, StopFilledAlt } from "@carbon/icons-react";
import {
  type DelegationNode,
  delegationTitle,
  type TurnSummary,
} from "api-server-api";
import { type ReactNode, useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CARD_SURFACE } from "@/components/ui/card";
import { DisclosureChevron } from "@/components/ui/disclosure";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { useDockDraftGuard } from "../../../hooks/use-dock-draft-guard.js";
import { useStore } from "../../../store.js";
import { ToolContentBlock } from "../../sessions/components/tool-chip.js";
import { useTurnSpend } from "../../spend/api/queries.js";
import { TurnTelemetry } from "../../telemetry/components/turn-telemetry.js";
import { useStopDelegation } from "../api/mutations.js";
import {
  type DelegationModel,
  delegationModel,
  delegationState,
  type DelegationTarget,
  delegationWaitReason,
  runningSubAgents,
  stoppedLine,
} from "../lib/delegation-state.js";
import { DelegationStatePill } from "./delegation-state-pill.js";

interface Props {
  node: DelegationNode;
  driverAgentId: string;
  targets: ReadonlyMap<string, DelegationTarget>;
  turns: Readonly<Record<string, TurnSummary>> | undefined;
}

function subtitle(node: DelegationNode): string {
  const parts = ["Temporary agent", node.templateId ?? node.image];
  return parts.filter((p): p is string => !!p).join(" · ");
}

export function DelegationCard({ node, driverAgentId, targets, turns }: Props) {
  const [open, setOpen] = useState(false);
  const target = targets.get(node.id);
  const state = delegationState(node, target);
  const waitReason = delegationWaitReason(node, target);
  const failed = state === "failed";
  const ownRunning = node.status === "running";
  const working = ownRunning ? 0 : runningSubAgents(node);
  const turn = turns?.[node.id];
  const spendTurns = useMemo(() => (turn ? [turn] : []), [turn]);
  const { data: turnSpend } = useTurnSpend(node.id, null, spendTurns);
  const model = delegationModel(node.requestedModel, turn?.models);

  return (
    <div className={cn(CARD_SURFACE, "border-border px-3 mt-2")}>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2.5 min-h-[52px] py-1.5 text-left"
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
              {node.stopped
                ? stoppedLine(node.stopped)
                : failed && node.errorReason
                  ? node.errorReason
                  : (waitReason ?? subtitle(node))}
            </span>
          </span>
        </button>
        {working > 0 && (
          <span className="inline-flex shrink-0 items-stretch overflow-hidden rounded-full border border-success text-green-700 dark:text-success">
            <Badge
              variant="outline"
              size="sm"
              className="rounded-none border-0 text-inherit"
            >
              {working} sub-agent{working === 1 ? "" : "s"} working
            </Badge>
            <StopSegment
              node={node}
              driverAgentId={driverAgentId}
              working={working}
              className="border-success"
            />
          </span>
        )}
        {ownRunning ? (
          <span className="inline-flex shrink-0 items-stretch overflow-hidden rounded-full bg-success-light text-green-700 dark:text-success">
            <DelegationStatePill state={state} className="rounded-none" />
            <StopSegment
              node={node}
              driverAgentId={driverAgentId}
              working={null}
              className="border-success/30"
            />
          </span>
        ) : (
          <DelegationStatePill state={state} />
        )}
      </div>

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
          </div>
          {node.children.map((child) => (
            <DelegationCard
              key={child.id}
              node={child}
              driverAgentId={driverAgentId}
              targets={targets}
              turns={turns}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the stop at the end of the pill it acts on: on the state pill while a run of its own goes, the agent and everything it started; on the sub-agents pill, where `working` counts the sub-agents it started that still run, only they.
function StopSegment({
  node,
  driverAgentId,
  working,
  className,
}: {
  node: DelegationNode;
  driverAgentId: string;
  working: number | null;
  className?: string;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const stop = useStopDelegation();
  const subAgents = `${working} sub-agent${working === 1 ? "" : "s"}`;
  const label = working === null ? "Stop this agent" : `Stop ${subAgents}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={stop.isPending}
      className={cn(
        "flex items-center border-l px-1.5 transition-colors hover:bg-danger-light hover:text-danger focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
        className,
      )}
      onClick={async () => {
        const ok =
          working === null
            ? await showConfirm(
                "Its work ends, and so does the work of every sub-agent it started. A kept agent keeps its files and its conversation; any other is removed, with every sub-agent it started. The driver gets a failed result.",
                "Stop this temporary agent?",
                { kind: "destructive", confirmLabel: "Stop agent" },
              )
            : await showConfirm(
                "It runs nothing itself. The work of the sub-agents it started ends; a kept one keeps its files and its conversation, any other is removed.",
                `Stop ${subAgents}?`,
                { kind: "destructive", confirmLabel: `Stop ${subAgents}` },
              );
        if (ok) stop.mutate({ driverAgentId, id: node.id });
      }}
    >
      <StopFilledAlt size={9} aria-hidden />
    </button>
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
