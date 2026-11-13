import { AgentOutdatedNotice } from "./agent-outdated-notice.js";

export function RuntimeOutdatedNotice() {
  return (
    <AgentOutdatedNotice>
      Live updates aren’t available on this agent, so the session list and files
      can take a few seconds to update.
    </AgentOutdatedNotice>
  );
}
