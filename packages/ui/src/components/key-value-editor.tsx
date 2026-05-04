import { Plus, X } from "lucide-react";

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

const INPUT_CLASS =
  "w-full h-9 rounded-lg border-2 border-border-light bg-bg px-3 text-[13px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted font-mono";

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
        <p className="text-[12px] text-text-muted">{emptyMessage}</p>
      )}
      {value.map((row, i) => {
        const invalid = row.key.length > 0 && !isValidEnvName(row.key);
        return (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <input
                className={`${INPUT_CLASS} ${invalid ? "border-danger" : ""}`}
                placeholder={keyPlaceholder}
                value={row.key}
                onChange={(e) =>
                  update(i, { key: e.target.value.toUpperCase() })
                }
                disabled={disabled}
              />
              {invalid && (
                <span className="text-[11px] text-danger">
                  Must match [A-Z_][A-Z0-9_]*
                </span>
              )}
            </div>
            <input
              className={`${INPUT_CLASS} flex-1`}
              placeholder={valuePlaceholder}
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
              disabled={disabled}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              disabled={disabled}
              className="btn-brutal h-9 w-9 shrink-0 rounded-md border-2 border-border-light bg-surface flex items-center justify-center text-text-muted hover:text-danger hover:border-danger"
              style={{ boxShadow: "var(--shadow-brutal-sm)" }}
              title="Remove"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        disabled={disabled}
        className="btn-brutal self-start h-8 rounded-md border-2 border-border-light bg-surface px-3 text-[12px] font-semibold text-text-secondary hover:text-accent hover:border-accent inline-flex items-center gap-1.5"
        style={{ boxShadow: "var(--shadow-brutal-sm)" }}
      >
        <Plus size={12} /> {addLabel}
      </button>
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
