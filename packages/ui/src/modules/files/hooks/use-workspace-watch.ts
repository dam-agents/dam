import { workspaceNoticeSchema } from "agent-runtime-api";

import {
  useAgentLiveUpdates,
  useAgentWatch,
} from "../../agents/hooks/use-agent-watch.js";
import { fileKeys } from "../api/keys.js";
import { paramsForExpanded, useExpandedDirs } from "../api/queries.js";

export function useWorkspaceWatch(agentId: string | null) {
  const expanded = useExpandedDirs(agentId);
  const paths = paramsForExpanded(expanded);
  const live = useAgentLiveUpdates(agentId);

  useAgentWatch({
    agentId,
    enabled: live,
    inputKey: JSON.stringify(paths),
    subscribe: (trpc, onData, onError) =>
      trpc.files.watch.subscribe({ paths }, { onData, onError }),
    notice: workspaceNoticeSchema,
    invalidate: (queryClient, id) =>
      void queryClient.invalidateQueries({ queryKey: fileKeys.tree(id) }),
  });
}
