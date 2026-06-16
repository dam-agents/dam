import { useEffect } from "react";

import { useStore } from "../../../store.js";
import { isProviderPresetType } from "../../../types.js";
import { useAgents } from "../../agents/api/queries.js";
import { useSecrets } from "../../secrets/api/queries.js";

const FIRST_RUN_FLAG = "platform-first-run-routed";

/**
 * Takes a genuinely blank account — zero sandboxes AND no provider — straight
 * into sandbox creation on initial load, replacing the old setup-progress bar.
 * Routes at most once per session (a `sessionStorage` flag), so deleting the
 * last sandbox to zero later can't bounce the user back into the wizard. Renders
 * nothing; it only triggers navigation.
 */
export function useFirstRunRedirect(): void {
  const { data: agentsData, isSuccess: agentsLoaded } = useAgents();
  const { data: secrets = [], isSuccess: secretsLoaded } = useSecrets();
  const view = useStore((s) => s.view);
  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);

  useEffect(() => {
    // Decide only once both signals have resolved, or a false-empty cache mid
    // fetch would route a returning user into the wizard.
    if (!agentsLoaded || !secretsLoaded) return;
    // Set the flag unconditionally on the first loaded pass — even when not
    // routing — so a later delete-to-zero in this session never triggers it.
    if (sessionStorage.getItem(FIRST_RUN_FLAG)) return;
    sessionStorage.setItem(FIRST_RUN_FLAG, "1");

    const noSandboxes = (agentsData?.list.length ?? 0) === 0;
    const noProvider = !secrets.some((s) => isProviderPresetType(s.type));
    // Don't hijack a deep link — only the default list view auto-routes.
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
