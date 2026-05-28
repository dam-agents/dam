import { Add as Plus, Close as X } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { isValidEnvName } from "../types.js";

export interface KeyValue {
  key: string;
  value: string;
}

interface KeyValueEditorProps {
  value: KeyValue[];
  onChange: (next: KeyValue[]) => void;
  disabled?: boolean;
  /** Value used when adding a new row. Default: empty string. */
  newRowValue?: string;
  /** Placeholder shown in the key input. Default: "ENV_NAME". */
  keyPlaceholder?: string;
  /** Placeholder shown in the value input. */
  valuePlaceholder?: string;
  /** Shown when the editor has zero rows. */
  emptyMessage?: string;
  /** Label on the add-row button. Default: "Add env var". */
  addLabel?: string;
}

/**
 * Repeater editor for an ordered list of key/value pairs. Keys must match
 * POSIX env-name rules — invalid keys are highlighted in danger tone and
 * callers should gate saves on `allKeyValuesValid`.
 */
export function KeyValueEditor({
  value,
  onChange,
  disabled,
  newRowValue = "",
  keyPlaceholder = "ENV_NAME",
  valuePlaceholder,
  emptyMessage,
  addLabel = "Add env var",
}: KeyValueEditorProps) {
  const update = (i: number, patch: Partial<KeyValue>) => {
    onChange(value.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { key: "", value: newRowValue }]);

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && emptyMessage && (
        <p className="text-[12px] text-muted-foreground">{emptyMessage}</p>
      )}
      {value.map((row, i) => {
        const invalid = row.key.length > 0 && !isValidEnvName(row.key);
        return (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <Input
                className={`font-mono ${invalid ? "border-destructive" : ""}`}
                placeholder={keyPlaceholder}
                value={row.key}
                onChange={(e) =>
                  update(i, { key: e.target.value.toUpperCase() })
                }
                disabled={disabled}
              />
              {invalid && (
                <span className="text-[11px] text-destructive">
                  Must match [A-Z_][A-Z0-9_]*
                </span>
              )}
            </div>
            <Input
              className="flex-1 font-mono"
              placeholder={valuePlaceholder}
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
              disabled={disabled}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => remove(i)}
              disabled={disabled}
              className="shrink-0 text-muted-foreground hover:text-destructive hover:border-destructive"
              title="Remove"
            >
              <X size={13} />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={add}
        disabled={disabled}
        className="self-start"
      >
        <Plus size={12} /> {addLabel}
      </Button>
    </div>
  );
}

export function sanitizeKeyValues(list: KeyValue[]): KeyValue[] {
  return list
    .map((v) => ({ key: v.key.trim(), value: v.value.trim() }))
    .filter((v) => v.key !== "");
}

export function allKeyValuesValid(list: KeyValue[]): boolean {
  return sanitizeKeyValues(list).every((v) => isValidEnvName(v.key));
}
