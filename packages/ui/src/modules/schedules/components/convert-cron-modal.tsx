import { rruleToText } from "api-server-api";
import { useMemo, useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { formatDateTime } from "@/lib/format-time";

import { emitToast } from "../../../lib/toast.js";
import type { Schedule } from "../../../types.js";
import { useUpdateSchedule } from "../api/mutations.js";
import type { ExactCronConversion } from "../lib/cron-conversion.js";
import { nextRRuleRuns } from "../lib/rrule-runs.js";
import { TIMEZONE_OPTIONS } from "../lib/schedule-form-options.js";
import { CRON_TIMEZONE, cronToText } from "../lib/schedule-format.js";

interface Props {
  schedule: Schedule;
  conversion: ExactCronConversion;
  onClose: () => void;
  onConverted: (converted: Schedule) => void;
}

const RUN_FORMAT: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
};

export function ConvertCronModal({
  schedule,
  conversion,
  onClose,
  onConverted,
}: Props) {
  const updateSchedule = useUpdateSchedule();
  const [timezone, setTimezone] = useState(CRON_TIMEZONE);
  const { rrule, from, cronRuns } = conversion;
  const convertedRuns = useMemo(
    () => nextRRuleRuns(rrule, timezone, from, cronRuns.length),
    [rrule, timezone, from, cronRuns.length],
  );
  const sameRuns =
    convertedRuns &&
    convertedRuns.length === cronRuns.length &&
    convertedRuns.every((run, i) => run.getTime() === cronRuns[i]?.getTime());

  const convert = () =>
    updateSchedule.mutate(
      {
        id: schedule.id,
        name: schedule.name,
        rrule,
        timezone,
        quietHours: [],
        task: schedule.task ?? "",
        sessionMode: schedule.sessionMode ?? "fresh",
        precheck: schedule.precheck,
        model: schedule.model,
        sessionTitle: schedule.sessionTitle,
      },
      {
        onSuccess: (converted) => {
          emitToast({
            kind: "success",
            message: `Schedule "${schedule.name}" converted`,
          });
          onConverted(converted);
        },
      },
    );

  return (
    <Modal onClose={onClose}>
      <DialogHeader
        title="Convert to the new format"
        subtitle={schedule.name}
        onClose={onClose}
      />
      <DialogBody className="flex flex-col gap-4">
        <p className="text-sm text-foreground">
          It runs on <code className="font-mono">{schedule.cron}</code>, a cron
          expression in UTC.
        </p>

        <FormField
          label="Timezone"
          hint="UTC keeps the same run times. Another timezone keeps the same clock times there, and follows its daylight saving changes."
        >
          <SearchableSelect
            value={timezone}
            onChange={setTimezone}
            options={TIMEZONE_OPTIONS}
            placeholder="Select a timezone"
          />
        </FormField>

        <div className="grid grid-cols-2 gap-4">
          <RunList
            title="Next runs now"
            runs={cronRuns}
            caption={`${cronToText(schedule.cron ?? "")} · ${CRON_TIMEZONE}`}
          />
          <RunList
            title="Next runs after converting"
            runs={convertedRuns}
            caption={`${rruleToText(rrule)} · ${timezone}`}
          />
        </div>

        <p className="text-sm text-muted-foreground">
          {convertedRuns &&
            (sameRuns
              ? "It runs at the same moments as now. "
              : "It runs at different moments from now. ")}
          Its prompt, session and other settings stay as they are. After
          converting, it opens in the editor.
        </p>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        label="Convert"
        pendingLabel="Converting…"
        pending={updateSchedule.isPending}
        disabled={!timezone}
        onSubmit={convert}
      />
    </Modal>
  );
}

function RunList({
  title,
  runs,
  caption,
}: {
  title: string;
  runs: Date[] | null;
  caption?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
      {runs ? (
        <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
          {runs.map((run) => (
            <li key={run.getTime()}>{formatDateTime(run, RUN_FORMAT)}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          This browser can&apos;t preview run times.
        </p>
      )}
    </div>
  );
}
