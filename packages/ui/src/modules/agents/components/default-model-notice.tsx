import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useDefaultModelNotices } from "../../home/hooks/use-default-model-notices.js";
import {
  defaultModelAction,
  defaultModelDetail,
  defaultModelHeadline,
  defaultModelStopsRuns,
} from "../../home/lib/default-model-copy.js";

export function DefaultModelNotice({ agentId }: { agentId: string | null }) {
  const { byAgentEvenDismissed } = useDefaultModelNotices();
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const notice = agentId ? byAgentEvenDismissed.get(agentId) : undefined;
  if (!agentId || !notice || !defaultModelStopsRuns(notice)) return null;

  return (
    <div
      role="status"
      data-testid="default-model-notice"
      className="flex items-center gap-2 border-b border-border/50 px-4 py-2 text-xs text-muted-foreground"
    >
      <span className="size-2 shrink-0 rounded-full bg-warning" />
      <span className="flex-1">
        {defaultModelHeadline(notice)}. {defaultModelDetail(notice)}
      </span>
      <Button
        size="sm"
        variant="outline"
        onClick={() => navigateToSandboxHome(agentId, "providers")}
      >
        {defaultModelAction(notice)}
      </Button>
    </div>
  );
}
