import {
  spendLimitAmountTextSchema,
  type SpendLimitScope,
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

import { useSetSpendLimit } from "../api/mutations.js";
import {
  alreadyReachedLine,
  otherStopsFirstLine,
  resetsAtLine,
  spentTodayLine,
  thisStopsFirstLine,
} from "../lib/copy.js";
import { amountText, localDayStart, UNIT_NAMES } from "../lib/format.js";
import { utcDayOf } from "../lib/utc-day.js";

export interface LimitComparison {
  spentMicros: number;
  other: { name: string; leftMicros: number } | null;
}

interface Props {
  scope: SpendLimitScope;
  unit: SpendUnit;
  subject: string;
  amountMicros: number | null;
  compare?: LimitComparison;
  onClose: () => void;
}

export function SpendLimitDialog({
  scope,
  unit,
  subject,
  amountMicros,
  compare,
  onClose,
}: Props) {
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
        subtitle={`For ${subject}. ${resetsAtLine(localDayStart(utcDayOf(new Date())))}`}
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
          {compare && (
            <ComparisonLines
              compare={compare}
              amountMicros={parsed.success ? parsed.data : null}
              unit={unit}
            />
          )}
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

function ComparisonLines({
  compare,
  amountMicros,
  unit,
}: {
  compare: LimitComparison;
  amountMicros: number | null;
  unit: SpendUnit;
}) {
  const left =
    amountMicros === null
      ? null
      : Math.max(0, amountMicros - compare.spentMicros);
  const line =
    left === null
      ? null
      : left === 0
        ? alreadyReachedLine(compare.spentMicros, unit)
        : compare.other && compare.other.leftMicros < left
          ? otherStopsFirstLine(
              compare.other.name,
              compare.other.leftMicros,
              unit,
            )
          : thisStopsFirstLine(left, unit);
  return (
    <>
      <p className="text-xs text-muted-foreground tabular-nums">
        {spentTodayLine(compare.spentMicros, unit)}
      </p>
      <p
        aria-live="polite"
        className={cn(
          "min-h-8 text-xs",
          left === 0 ? "text-danger" : "text-muted-foreground",
        )}
      >
        {line}
      </p>
    </>
  );
}
