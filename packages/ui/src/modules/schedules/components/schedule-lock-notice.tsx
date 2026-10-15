import type { ReactNode } from "react";

import type { CronConversion } from "../lib/cron-conversion.js";
import type { ScheduleLock } from "../lib/schedule-lock.js";

interface Notice {
  title: string;
  body: ReactNode;
  action?: string;
}

export function scheduleLockNotice(
  lock: ScheduleLock,
  sandboxName: string,
  conversion?: CronConversion,
): Notice {
  if (lock === "agent-managed") {
    return {
      title: "This schedule is managed by the agent",
      action: "Open chat",
      body: (
        <div className="flex flex-col gap-3">
          <p>
            {sandboxName} created this schedule, so changes must be made through
            the agent.
          </p>
          <p>
            Editing it here may cause it to become out of sync with the agent
            configuration.
          </p>
          <p>
            Ask the agent in chat to change when it runs or what it does. You
            can pause or delete it here anytime.
          </p>
        </div>
      ),
    };
  }
  if (lock === "once-fired") {
    return {
      title: "This one-time task has already run",
      body: (
        <p>
          A one-time task can be edited only before it runs. To run it again,
          create a new one-time task.
        </p>
      ),
    };
  }
  const intro = (
    <p>
      It runs on a cron expression in UTC. The editor works with the newer
      format only, so it can&apos;t show this schedule&apos;s timing without
      converting it.
    </p>
  );
  if (conversion?.kind === "exact") {
    return {
      title: "This schedule uses the older cron format",
      action: "Convert to the new format",
      body: (
        <div className="flex flex-col gap-3">
          {intro}
          <p>
            Convert it to edit it like any other schedule. You see its next run
            times before and after, and nothing changes until you confirm.
          </p>
        </div>
      ),
    };
  }
  return {
    title: "This schedule uses the older cron format",
    body: (
      <div className="flex flex-col gap-3">
        {intro}
        {conversion && (
          <p>It can&apos;t be converted exactly. {conversion.reason}</p>
        )}
        <p>
          To change when it runs, delete this schedule and create a new one. You
          can pause it here anytime.
        </p>
      </div>
    ),
  };
}
