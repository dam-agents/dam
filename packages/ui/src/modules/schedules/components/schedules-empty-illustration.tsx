import { Checkmark, Time } from "@carbon/icons-react";

import {
  IconSquare,
  IconTile,
  ILLUSTRATION_CARD,
  IllustrationCanvas,
  SlackMessage,
  TILE_LEFT,
  TILE_TOP_RIGHT,
} from "@/components/empty-illustration";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

import { ConnectionIcon } from "../../connections/components/connection-icon.js";

const SCHEDULES = [
  { name: "Nightly link check", cadence: "Every day at 2:00 AM" },
  { name: "Weekday PR review", cadence: "Weekdays at 9:00 AM" },
];

export function SchedulesEmptyIllustration({
  className,
}: {
  className?: string;
}) {
  return (
    <IllustrationCanvas className={className}>
      <div
        className={`${ILLUSTRATION_CARD} left-[18px] top-[20px] w-[380px] divide-y divide-border px-4`}
      >
        {SCHEDULES.map((s) => (
          <div key={s.name} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold leading-[23px] text-foreground">
                {s.name}
              </p>
              <p className="flex items-center gap-1 text-[14px] leading-[22px] text-muted-foreground">
                <Time size={16} />
                {s.cadence}
              </p>
            </div>
            <Switch checked onCheckedChange={() => {}} />
          </div>
        ))}
      </div>

      <div
        className={`${ILLUSTRATION_CARD} left-[201px] top-[154px] flex w-[381px] items-center gap-4 rounded-xl p-4`}
      >
        <IconSquare>
          <Checkmark size={16} className="text-success" />
        </IconSquare>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold leading-[23px] text-foreground">
            Nightly link check
          </p>
          <p className="text-[14px] leading-[22px] text-muted-foreground">
            Ran at 2:00 AM &middot; 4 min
          </p>
        </div>
        <Badge variant="success">Completed</Badge>
      </div>

      <SlackMessage className="left-[102px] top-[251px]" time="2:04 AM">
        All 142 docs pages passed tonight.
      </SlackMessage>

      <IconTile {...TILE_TOP_RIGHT}>
        <Time size={16} />
      </IconTile>
      <IconTile {...TILE_LEFT}>
        <ConnectionIcon iconSlug="slack" alt="" size={16} />
      </IconTile>
    </IllustrationCanvas>
  );
}
