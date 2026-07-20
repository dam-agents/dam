import { Add, TrashCan } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

import { FormError } from "../../../components/form-error.js";
import { TIME_OPTIONS } from "../lib/schedule-form-options.js";

export type QuietRow = { startTime: string; endTime: string; enabled: boolean };

interface RowProps {
  row: QuietRow;
  onChange: (patch: Partial<QuietRow>) => void;
  onRemove: () => void;
}

function QuietHoursRow({ row, onChange, onRemove }: RowProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-[120px]">
        <Select
          className="h-[40px]"
          value={row.startTime}
          onChange={(e) => onChange({ startTime: e.target.value })}
        >
          {TIME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <span className="text-[13px] text-muted-foreground">→</span>
      <div className="w-[120px]">
        <Select
          className="h-[40px]"
          value={row.endTime}
          onChange={(e) => onChange({ endTime: e.target.value })}
        >
          {TIME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
      <Switch
        checked={row.enabled}
        onCheckedChange={(v) => onChange({ enabled: v })}
        label="Window enabled"
        className="ml-1"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-auto h-[24px] w-[24px] text-muted-foreground hover:text-destructive"
        onClick={onRemove}
      >
        <TrashCan size={13} />
      </Button>
    </div>
  );
}

interface Props {
  value: QuietRow[];
  onChange: (next: QuietRow[]) => void;
  error?: string;
  unreachableError?: string;
}

/** Add/remove/enable editor for quiet-hours windows. A window's start time is
 *  inside the silenced range, its end time is outside (22:00→06:00 skips the
 *  22:00 tick and fires at 06:00). */
export function QuietHoursEditor({
  value,
  onChange,
  error,
  unreachableError,
}: Props) {
  const add = () =>
    onChange([
      ...value,
      { startTime: "22:00", endTime: "06:00", enabled: true },
    ]);
  const update = (idx: number, patch: Partial<QuietRow>) =>
    onChange(value.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const addButton = (
    <Button
      type="button"
      variant="outline"
      className="h-[30px] px-2.5 text-[14px]"
      onClick={add}
    >
      <Add size={16} /> Add
    </Button>
  );

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 ? (
        <>
          <SectionLabel>Quiet hours</SectionLabel>
          <div>{addButton}</div>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <SectionLabel>Quiet hours</SectionLabel>
            {addButton}
          </div>
          <p className="text-[13px] text-muted-foreground">
            Runs inside a window are suppressed; start is inside, end is
            outside.
          </p>
          {value.map((row, idx) => (
            <QuietHoursRow
              key={idx}
              row={row}
              onChange={(patch) => update(idx, patch)}
              onRemove={() => remove(idx)}
            />
          ))}
        </>
      )}
      <FormError message={error} />
      <FormError message={unreachableError} />
    </div>
  );
}
