import { Checkmark, Time } from "@carbon/icons-react";
import type { ReactNode } from "react";

import type { MockScheduleCardPart } from "../../../types.js";

function FieldRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <span className="shrink-0 text-[14px] text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 text-right text-[14px] text-foreground">
        {children}
      </span>
    </div>
  );
}

export function MockScheduleCard({
  schedule,
}: {
  schedule: MockScheduleCardPart["schedule"];
}) {
  return (
    <div className="w-full max-w-[420px] overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <Time size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold text-foreground">
            {schedule.name}
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-success">
          <Checkmark size={14} />
          <span className="text-[14px] font-medium">Active</span>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border">
        <FieldRow label="Frequency">{schedule.frequency}</FieldRow>
        <FieldRow label="Days">{schedule.days}</FieldRow>
        <FieldRow label="Time">{schedule.time}</FieldRow>
        <FieldRow label="Timezone">{schedule.timezone}</FieldRow>
        <FieldRow label="Session type">{schedule.sessionMode}</FieldRow>
      </div>

      <div className="border-t border-border bg-muted/30 px-4 py-3">
        <p className="line-clamp-2 text-[14px] text-muted-foreground">
          {schedule.prompt}
        </p>
      </div>
    </div>
  );
}
