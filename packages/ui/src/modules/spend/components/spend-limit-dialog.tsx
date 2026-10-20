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

import { useSetSpendLimit } from "../api/mutations.js";
import { resetsAtLine } from "../lib/copy.js";
import { amountText, localDayStart, UNIT_NAMES } from "../lib/format.js";
import { utcDayOf } from "../lib/utc-day.js";

interface Props {
  scope: SpendLimitScope;
  unit: SpendUnit;
  subject: string;
  amountMicros: number | null;
  onClose: () => void;
}

export function SpendLimitDialog({
  scope,
  unit,
  subject,
  amountMicros,
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
