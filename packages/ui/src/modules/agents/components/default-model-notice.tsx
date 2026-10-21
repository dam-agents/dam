import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useDefaultModelNotices } from "../../home/hooks/use-default-model-notices.js";
import {
  defaultModelAction,
  defaultModelHeadline,
  defaultModelStopsRuns,
  stoppedRuns,
} from "../../home/lib/default-model-copy.js";

export function DefaultModelNotice({ agentId }: { agentId: string }) {
  const { byAgentEvenDismissed } = useDefaultModelNotices();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const notices = (byAgentEvenDismissed.get(agentId) ?? []).filter(
    defaultModelStopsRuns,
  );
  if (notices.length === 0) return null;

  return notices.map((notice) => (
    <p
      key={notice.id}
      role="status"
      data-testid="default-model-notice"
      className="flex flex-wrap items-center gap-x-1.5 pl-3 text-xs text-muted-foreground"
    >
      <span className="size-1.5 shrink-0 rounded-full bg-warning" />
      <span>
        {defaultModelHeadline(notice)}: {stoppedRuns(notice.kinds)} won't run.
      </span>
      <Button
        variant="link"
        size="inline"
        className="text-xs"
        onClick={() => navigateToSandboxHome(agentId, "providers")}
      >
        {defaultModelAction(notice)}
      </Button>
    </p>
  ));
}
