import { Information } from "@carbon/icons-react";

import { Notice } from "@/components/ui/notice";

import type { AgentView } from "../../../types.js";

export function HomeRepairedNotice({
  agent,
}: {
  agent: Pick<AgentView, "homeRepaired">;
}) {
  if (!agent.homeRepaired) return null;
  return (
    <div className="mb-6 flex flex-col gap-1">
      <Notice
        icon={Information}
        title="This agent's disk was repaired when it last started."
      >
        A check at start found file system errors on its disk, which storage
        that ran full or a machine that stopped without saving can leave, and
        repaired them. Files in the damaged folders may be missing, so ask the
        agent to check that its work is intact.
      </Notice>
      <details className="px-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer">What the check said</summary>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-2xs">
          {agent.homeRepaired}
        </pre>
      </details>
    </div>
  );
}
