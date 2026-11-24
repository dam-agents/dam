import { Restart } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { emitToast } from "@/lib/toast";

import { useStore } from "../../../store.js";
import { agentTrpc } from "../../agents/agent-trpc.js";
import type { SectionHeaderSlot } from "./sandbox-home-header.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Browser section of an Agent's settings, as
 * the design places it: the two controls of the browser the Agent drives —
 * clear its data, which drops every sign-in, cookie and site's data after the
 * same confirm the browser panel asks, and restart it. Both are the browser
 * panel's own calls to the Agent's runtime.
 */
export function SandboxBrowserSection({
  agentId,
  header,
}: {
  agentId: string;
  header: SectionHeaderSlot;
}) {
  const showConfirm = useStore((s) => s.showConfirm);

  const report = (done: string) => (e: unknown) =>
    e === undefined
      ? emitToast({ kind: "success", message: done })
      : emitToast({
          kind: "error",
          message:
            e instanceof Error ? e.message : "The browser did not answer",
        });

  const clearData = async () => {
    const ok = await showConfirm(
      "Sign-ins, cookies and site data stored in this agent's browser are deleted.",
      "Clear browser data?",
      { kind: "destructive", confirmLabel: "Clear data" },
    );
    if (!ok) return;
    agentTrpc(agentId)
      .browser.clearData.mutate()
      .then(() => report("Browser data cleared")(undefined), report(""));
  };

  const restart = () =>
    agentTrpc(agentId)
      .browser.restart.mutate()
      .then(() => report("Browser restarted")(undefined), report(""));

  return (
    <div className="flex flex-col gap-3">
      {header()}
      <div className="flex gap-2">
        <Button
          variant="destructive"
          size="sm"
          data-testid="browser-clear-data"
          onClick={() => void clearData()}
        >
          Clear browser data
        </Button>
        <Button
          variant="secondary"
          size="sm"
          data-testid="browser-restart"
          onClick={() => void restart()}
        >
          <Restart size={16} />
          Restart browser
        </Button>
      </div>
    </div>
  );
}
