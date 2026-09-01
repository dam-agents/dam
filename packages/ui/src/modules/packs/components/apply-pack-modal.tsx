import { CheckmarkFilled, Information } from "@carbon/icons-react";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";

import {
  INGREDIENT_ICON,
  type Pack,
  type PackIngredientKind,
} from "../data/packs.js";

/**
 * Applying a pack is additive — it never overwrites what the agent already has.
 * An ingredient the agent already carries is skipped with a reason, mirroring
 * how `skillSetApplyResult` already reports a partial skill-set apply.
 *
 * A pack's slots are never in the added list. Applying cannot supply a repo, a
 * channel or a knowledge base, so they are listed as the user's to fill in.
 */
export type ApplySkipReason = "already-on-agent";

export const SKIP_REASON_TEXT: Record<ApplySkipReason, string> = {
  "already-on-agent": "Already on this agent — kept as it is",
};

export interface ApplyLine {
  kind: PackIngredientKind;
  name: string;
  skip?: ApplySkipReason;
  /** On a slot line: what the user still has to point it at. */
  note?: string;
}

export interface ApplyResult {
  added: ApplyLine[];
  skipped: ApplyLine[];
  /** Slots the user fills in afterwards. Never blocks applying. */
  toFill: ApplyLine[];
}

function Line({ line }: { line: ApplyLine }) {
  const Icon = INGREDIENT_ICON[line.kind];
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card">
        <Icon className="size-4 text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{line.name}</p>
        {(line.skip ?? line.note) && (
          <p className="text-sm text-muted-foreground">
            {line.skip ? SKIP_REASON_TEXT[line.skip] : line.note}
          </p>
        )}
      </div>
    </div>
  );
}

function Section({ title, lines }: { title: string; lines: ApplyLine[] }) {
  if (lines.length === 0) return null;
  return (
    <>
      <h3 className="mt-7 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="mt-3 flex flex-col gap-2">
        {lines.map((line) => (
          <Line key={`${line.kind}-${line.name}`} line={line} />
        ))}
      </div>
    </>
  );
}

interface Props {
  pack: Pack;
  agentName: string;
  /** What applying would add, and what it would leave alone. */
  preview: ApplyResult;
  onClose: () => void;
}

export function ApplyPackModal({ pack, agentName, preview, onClose }: Props) {
  const [applied, setApplied] = useState(false);

  if (applied) {
    return (
      <Modal widthClass="w-[560px]">
        <DialogHeader title={`${pack.name} applied`} onClose={onClose} />
        <DialogBody>
          <div className="flex items-center gap-2 text-sm text-foreground">
            <CheckmarkFilled className="size-4 text-success" />
            {preview.added.length} added to {agentName}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {preview.added.map((line) => (
              <Line key={`${line.kind}-${line.name}`} line={line} />
            ))}
          </div>

          <Section title="Skipped" lines={preview.skipped} />
          <Section title="Yours to fill in" lines={preview.toFill} />
        </DialogBody>
        <DialogActions
          onCancel={onClose}
          cancelLabel="Close"
          label="Open agent"
          pendingLabel="Opening…"
          onSubmit={onClose}
        />
      </Modal>
    );
  }

  return (
    <Modal widthClass="w-[560px]">
      <DialogHeader
        title={`Apply ${pack.name}`}
        subtitle={`Adds to ${agentName}. Nothing already set up is changed.`}
        onClose={onClose}
      />
      <DialogBody>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Will be added
        </h3>
        <div className="mt-3 flex flex-col gap-2">
          {preview.added.map((line) => (
            <Line key={`${line.kind}-${line.name}`} line={line} />
          ))}
        </div>

        <Section title="Left as it is" lines={preview.skipped} />
        <Section title="Yours to fill in" lines={preview.toFill} />

        <Callout tone="info" size="sm" className="mt-4">
          <div className="flex gap-2">
            <Information className="mt-0.5 size-4 shrink-0 text-info" />
            <p className="text-sm text-muted-foreground">
              You can change any of these on the agent afterwards.
            </p>
          </div>
        </Callout>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        label="Apply pack"
        pendingLabel="Applying…"
        onSubmit={() => setApplied(true)}
      />
    </Modal>
  );
}
