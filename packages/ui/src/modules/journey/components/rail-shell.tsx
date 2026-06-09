import type { ReactNode } from "react";

import { IconRail } from "./icon-rail.js";

/** Full-screen frame with the left icon rail and a centered content column.
 *  Used by the landing and the standalone Settings / Inbox / egress pages. */
export function RailShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-dvh bg-background">
      <IconRail />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-6 py-10 md:py-14">
          {children}
        </div>
      </main>
    </div>
  );
}
