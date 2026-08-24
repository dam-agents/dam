import type { ReactNode } from "react";

import type { ScheduleLock } from "../lib/schedule-lock.js";

interface Notice {
  title: string;
  body: ReactNode;
  action?: string;
}

export function scheduleLockNotice(
  lock: ScheduleLock,
  sandboxName: string,
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
  return {
    title: "This schedule uses the older cron format",
    body: (
      <div className="flex flex-col gap-3">
        <p>
          It runs on a cron expression in UTC. The editor works with the newer
          format only, so it can&apos;t show this schedule&apos;s timing without
          rewriting it.
        </p>
        <p>
          To change when it runs, delete this schedule and create a new one. You
          can pause it here anytime.
        </p>
      </div>
    ),
  };
}
