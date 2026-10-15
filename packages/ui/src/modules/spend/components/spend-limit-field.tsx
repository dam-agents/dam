import {
  spendLimitAmountTextSchema,
  type SpendLimitScope,
  type SpendUnit,
} from "api-server-api";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RemoveButton } from "@/components/ui/remove-button";
import { cn } from "@/lib/utils";

import { useSetSpendLimit } from "../api/mutations.js";
import { amountText, formatDailyAmount, UNIT_NAMES } from "../lib/format.js";
import { HelpTip } from "./help-tip.js";

interface Props {
  label: string;
  help?: string | null;
  scope: SpendLimitScope;
  unit: SpendUnit;
  amountMicros: number | null;
}

export function SpendLimitField({
  label,
  help,
  scope,
  unit,
  amountMicros,
}: Props) {
  const setLimit = useSetSpendLimit();
  const [draft, setDraft] = useState<string | null>(null);
  const save = (next: number | null) =>
    setLimit.mutate(
      { scope, amountMicros: next },
      { onSuccess: () => setDraft(null) },
    );

  if (draft !== null) {
    return (
      <SpendLimitEditor
        label={label}
        help={help}
        unit={unit}
        draft={draft}
        pending={setLimit.isPending}
        onChange={setDraft}
        onSave={save}
        onCancel={() => setDraft(null)}
      />
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="flex items-center gap-1.5 text-sm text-foreground">
        {label}
        {help && <HelpTip content={help} />}
      </span>
      <span
        className={cn(
          "font-mono text-sm tabular-nums",
          amountMicros === null ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {amountMicros === null
          ? "No limit"
          : formatDailyAmount(amountMicros, unit)}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant="outline"
          size="sm"
          disabled={setLimit.isPending}
          onClick={() =>
            setDraft(amountMicros === null ? "" : amountText(amountMicros))
          }
        >
          {amountMicros === null ? "Set limit" : "Edit"}
        </Button>
        {amountMicros !== null && (
          <RemoveButton
            label={`Remove the ${label.toLowerCase()}`}
            disabled={setLimit.isPending}
            onClick={() => save(null)}
          />
        )}
      </div>
    </div>
  );
}

function SpendLimitEditor({
  label,
  help,
  unit,
  draft,
  pending,
  onChange,
  onSave,
  onCancel,
}: {
  label: string;
  help?: string | null;
  unit: SpendUnit;
  draft: string;
  pending: boolean;
  onChange: (draft: string) => void;
  onSave: (micros: number) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const parsed = spendLimitAmountTextSchema.safeParse(draft);
  const error =
    draft.trim() === "" || parsed.success
      ? undefined
      : "Enter an amount like 10 or 0.25.";

  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.success && !pending) onSave(parsed.data);
      }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex items-center gap-1.5 text-sm text-foreground">
          <label htmlFor={id}>{label}</label>
          {help && <HelpTip content={help} />}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Input
            id={id}
            autoFocus
            size="sm"
            inputMode="decimal"
            placeholder="10.00"
            variant={error ? "invalid" : "standard"}
            className="w-28 font-mono"
            value={draft}
            aria-invalid={error !== undefined}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") onCancel();
            }}
          />
          <span className="text-xs text-muted-foreground">
            {UNIT_NAMES[unit]}
          </span>
          <Button size="sm" type="submit" disabled={!parsed.success || pending}>
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </form>
  );
}
