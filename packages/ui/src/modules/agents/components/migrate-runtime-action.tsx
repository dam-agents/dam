import { Migrate, Renew, Undo, WarningAlt } from "@carbon/icons-react";
import type * as React from "react";
import { match } from "ts-pattern";

import { Button } from "@/components/ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

import type { AgentView } from "../../../types.js";
import { useVmRuntime } from "../../features/hooks/use-vm-runtime.js";
import { migrateAction } from "../utils/runtime-migration.js";

interface Props {
  agent: AgentView;
  onMigrate: () => void;
  onAbort: () => void;
  onRetry: () => void;
  pending: boolean;
  controlsBusy: boolean;
}

export function MigrateRuntimeAction({
  agent,
  onMigrate,
  onAbort,
  onRetry,
  pending,
  controlsBusy,
}: Props) {
  const action = migrateAction(agent, useVmRuntime(), pending);
  if (!action) return null;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return match(action)
    .with({ kind: "requesting" }, () => (
      <span onClick={stop}>
        <MigratingButton label="Migrating…" title="Requesting the move" />
      </span>
    ))
    .with({ kind: "migrating" }, (a) => (
      <span className="flex items-center gap-1" onClick={stop}>
        <MigratingButton label={a.label} title={a.title} />
        {a.abortable && (
          <AbortButton onAbort={onAbort} disabled={controlsBusy} />
        )}
      </span>
    ))
    .with({ kind: "failed" }, (a) => (
      <span className="flex items-center gap-1" onClick={stop}>
        <span
          className="flex items-center gap-1 text-sm font-medium text-danger"
          title={a.title}
          role="status"
          tabIndex={0}
          aria-label={`Migration failed: ${a.title}`}
        >
          <WarningAlt size={16} aria-hidden />
          Migration failed
        </span>
        {a.retryable && (
          <Button
            variant="ghost"
            size="sm"
            disabled={controlsBusy}
            onClick={onRetry}
            className="shrink-0 font-medium"
          >
            <Renew size={16} />
            Retry
          </Button>
        )}
        {a.abortable && (
          <AbortButton onAbort={onAbort} disabled={controlsBusy} />
        )}
      </span>
    ))
    .with({ kind: "offer" }, () => (
      <OfferButton onMigrate={onMigrate} stop={stop} />
    ))
    .exhaustive(() => null);
}

function OfferButton({
  onMigrate,
  stop,
}: {
  onMigrate: () => void;
  stop: (e: React.MouseEvent) => void;
}) {
  return (
    <span onClick={stop}>
      <HoverCard>
        <HoverCardTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 font-medium text-accent hover:bg-accent-light hover:text-accent-hover"
            onClick={onMigrate}
          >
            <Migrate size={16} />
            Migrate
          </Button>
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="end"
          className="flex w-[300px] flex-col gap-2 text-sm"
        >
          <p className="font-bold text-foreground">Move to the new runtime</p>
          <p className="text-muted-foreground">
            The agent restarts on the new sandbox runtime. Its home directory,
            with the workspace and settings, is copied over, and the agent is
            unavailable while the copy runs. The move can be undone until the
            agent first starts on the new runtime.
          </p>
        </HoverCardContent>
      </HoverCard>
    </span>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: a disabled button takes no pointer events, so a hover card on it would never open in the one state that has something to report. The phase's reason rides the button's tooltip instead, which the button shows even while disabled.
function MigratingButton({ label, title }: { label: string; title: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled
      tooltip={title}
      className="shrink-0 font-medium text-accent"
    >
      <Migrate size={16} />
      {label}
    </Button>
  );
}

function AbortButton({
  onAbort,
  disabled,
}: {
  onAbort: () => void;
  disabled: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      tone="danger"
      disabled={disabled}
      onClick={onAbort}
      className="shrink-0 font-medium"
    >
      <Undo size={16} />
      Abort
    </Button>
  );
}
