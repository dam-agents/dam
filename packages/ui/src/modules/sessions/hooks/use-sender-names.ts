import { useMemo } from "react";

import { getUser } from "../../../auth.js";
import { useAgent } from "../../agents/api/queries.js";
import { type SenderNames, senderNames } from "../lib/sender-names.js";

export function useSenderNames(agentId: string | null): SenderNames {
  const access = useAgent(agentId)?.access;
  const viewerSub = getUser()?.profile.sub;
  return useMemo(() => senderNames(viewerSub, access), [viewerSub, access]);
}
