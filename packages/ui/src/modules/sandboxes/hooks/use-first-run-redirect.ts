import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { isProviderPresetType } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { useSecrets } from "../../secrets/api/queries.js";

const FIRST_RUN_FLAG = "platform-first-run-routed";

export function useFirstRunRedirect(): void {
  const { data: agentsData, isSuccess: agentsLoaded } = useAgents();
  const { data: secrets = [], isSuccess: secretsLoaded } = useSecrets();
  const view = useStore((s) => s.view);
  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);

  useEffect(() => {
    if (!agentsLoaded || !secretsLoaded) return;
    // Set the flag unconditionally on the first loaded pass — even when not
    // routing — so a later delete-to-zero in this session never triggers it.
    if (sessionStorage.getItem(FIRST_RUN_FLAG)) return;
    sessionStorage.setItem(FIRST_RUN_FLAG, "1");

    const noSandboxes = (agentsData?.list.length ?? 0) === 0;
    const noProvider = !secrets.some((s) => isProviderPresetType(s.type));
    if (noSandboxes && noProvider && view === "list") navigateToCreateSandbox();
  }, [
    agentsLoaded,
    secretsLoaded,
    agentsData,
    secrets,
    view,
    navigateToCreateSandbox,
  ]);
}
