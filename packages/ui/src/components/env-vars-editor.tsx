import { Add, Close } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { type EnvVar, isValidEnvName } from "../types.js";

export function EnvVarsEditor({
  value,
  onChange,
  disabled,
}: {
  value: EnvVar[];
  onChange: (next: EnvVar[]) => void;
  disabled?: boolean;
}) {
  const update = (i: number, patch: Partial<EnvVar>) => {
    onChange(value.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));
  const add = () => onChange([...value, { name: "", value: "" }]);

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No env vars set. Add one below.
        </p>
      )}
      {value.map((row, i) => {
        const invalid = row.name.length > 0 && !isValidEnvName(row.name);
        return (
          <div key={i} className="flex items-start gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <Input
                size="sm"
                className={`font-mono ${invalid ? "border-destructive" : ""}`}
                placeholder="ENV_NAME"
                value={row.name}
                onChange={(e) =>
                  update(i, { name: e.target.value.toUpperCase() })
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
              size="sm"
              className="flex-1 font-mono"
              placeholder="value"
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
              disabled={disabled}
            />
            <Button
              type="button"
              variant="outline"
              tone="danger"
              size="icon-sm"
              onClick={() => remove(i)}
              disabled={disabled}
              className="shrink-0 text-muted-foreground"
              aria-label="Remove"
            >
              <Close size={13} />
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
        <Add size={12} /> Add env var
      </Button>
    </div>
  );
}

export function sanitizeEnvVars(list: EnvVar[]): EnvVar[] {
  return list
    .map((v) => ({ name: v.name.trim(), value: v.value.trim() }))
    .filter((v) => v.name !== "");
}

export function allEnvVarsValid(list: EnvVar[]): boolean {
  return sanitizeEnvVars(list).every((v) => isValidEnvName(v.name));
}
