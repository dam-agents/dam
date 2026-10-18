import { Edit, InfinitySymbol } from "@carbon/icons-react";
import {
  spendLimitAmountTextSchema,
  type SpendLimitScope,
  type SpendLimitView,
  type SpendUnit,
} from "api-server-api";
import { useId, useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { SpendBarTrack } from "../../metrics/components/spend-bar.js";
import { useSetSpendLimit } from "../api/mutations.js";
import { amountText, spendLimitSentence, UNIT_NAMES } from "../lib/format.js";
import { LIMIT_STATE_FILL, LIMIT_STATE_TEXT } from "../lib/state-colors.js";
import { HelpTip } from "./help-tip.js";

interface Props {
  scope: SpendLimitScope;
  unit: SpendUnit;
  spentMicros: number;
  limit: SpendLimitView | undefined;
  subject: string;
  help?: string | null;
  editable?: boolean;
}

function continuedNote(extensions: number): string | null {
  if (extensions === 0) return null;
  return extensions === 1
    ? " Continued once today."
    : ` Continued ${String(extensions)} times today.`;
}

export function SpendLimitLine({
  scope,
  unit,
  spentMicros,
  limit,
  subject,
  help,
  editable = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const spent = limit?.spentMicros ?? spentMicros;
  const [before, amount, after] = spendLimitSentence(
    spent,
    limit?.amountMicros ?? null,
    unit,
    subject,
  );
  const pct =
    limit && limit.effectiveMicros > 0
      ? Math.min(100, (spent / limit.effectiveMicros) * 100)
      : 100;

  return (
    <div className="flex flex-col gap-1.5">
      <p
        className={cn(
          "text-sm",
          limit ? LIMIT_STATE_TEXT[limit.state] : "text-foreground",
        )}
      >
        {before}
        {editable ? (
          <Button
            variant="link"
            size="inline"
            className="gap-1 font-mono tabular-nums text-inherit underline decoration-1 underline-offset-2 hover:decoration-2"
            aria-label={`Set daily limit for ${subject}`}
            tooltip="Set daily limit"
            onClick={() => setOpen(true)}
          >
            {amount === "∞" ? <InfinitySymbol size={16} /> : amount}
            <Edit size={14} />
          </Button>
        ) : (
          <span className="font-mono tabular-nums">{amount}</span>
        )}
        {after}
        {limit && continuedNote(limit.extensions)}
        {help && (
          <span className="ml-1.5 inline-flex align-middle">
            <HelpTip content={help} />
          </span>
        )}
      </p>
      {limit && (
        <SpendBarTrack
          pct={pct}
          fillClassName={LIMIT_STATE_FILL[limit.state]}
          label={`Daily limit for ${subject}: ${String(Math.round(pct))}% used`}
        />
      )}
      {open && (
        <SpendLimitDialog
          scope={scope}
          unit={unit}
          subject={subject}
          amountMicros={limit?.amountMicros ?? null}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

function SpendLimitDialog({
  scope,
  unit,
  subject,
  amountMicros,
  onClose,
}: {
  scope: SpendLimitScope;
  unit: SpendUnit;
  subject: string;
  amountMicros: number | null;
  onClose: () => void;
}) {
  const id = useId();
  const setLimit = useSetSpendLimit();
  const [draft, setDraft] = useState(
    amountMicros === null ? "" : amountText(amountMicros),
  );
  const parsed = spendLimitAmountTextSchema.safeParse(draft);
  const error =
    draft.trim() === "" || parsed.success
      ? undefined
      : "Enter an amount like 10 or 0.25.";
  const pending = setLimit.isPending;
  const save = (next: number | null) =>
    setLimit.mutate({ scope, amountMicros: next }, { onSuccess: onClose });

  return (
    <Modal size="sm" onClose={pending ? undefined : onClose}>
      <DialogHeader
        title="Set daily limit"
        subtitle={`For ${subject}. Counts one UTC day.`}
        onClose={onClose}
        closeDisabled={pending}
      />
      <DialogBody>
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (parsed.success && !pending) save(parsed.data);
          }}
        >
          <label htmlFor={id} className="text-sm text-foreground">
            Daily limit
          </label>
          <div className="flex items-center gap-2">
            <Input
              id={id}
              autoFocus
              inputMode="decimal"
              placeholder="10.00"
              variant={error ? "invalid" : "standard"}
              className="w-36 font-mono"
              value={draft}
              aria-invalid={error !== undefined}
              onChange={(event) => setDraft(event.target.value)}
            />
            <span className="text-sm text-muted-foreground">
              {UNIT_NAMES[unit]}
            </span>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
        </form>
      </DialogBody>
      <DialogActions
        leading={
          amountMicros !== null && (
            <Button
              variant="ghost"
              tone="danger"
              disabled={pending}
              onClick={() => save(null)}
            >
              Remove limit
            </Button>
          )
        }
        onCancel={onClose}
        cancelDisabled={pending}
        label="Save"
        pendingLabel="Saving…"
        pending={pending}
        disabled={!parsed.success}
        onSubmit={() => parsed.success && save(parsed.data)}
      />
    </Modal>
  );
}
