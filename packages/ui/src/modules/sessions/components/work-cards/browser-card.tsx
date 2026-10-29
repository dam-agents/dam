import { Spinner } from "@/components/ui/spinner";

import { useDevToolsState } from "../../../../mock/dev-tools-state.js";
import { useStore } from "../../../../store.js";
import type { WorkBrowser } from "../../../../types.js";
import { browserLinkLabel } from "../../../browser/lib/browser-link.js";
import { WorkCardShell } from "./work-card-shell.js";

type BrowserStatus = NonNullable<WorkBrowser["status"]>;

export function BrowserCard({ part }: { part: WorkBrowser }) {
  const agentId = useStore((s) => s.selectedAgent);
  const setOpenBrowser = useStore((s) => s.setOpenBrowser);
  const devOverride = useDevToolsState((s) => s.browserStatus);
  const status: BrowserStatus =
    (import.meta.env.VITE_MOCK ? devOverride : null) ?? part.status ?? "ready";

  if (status === "loading") {
    return (
      <WorkCardShell
        title="Loading browser…"
        accessory={<Spinner size={14} />}
      />
    );
  }

  if (status === "error") {
    return (
      <WorkCardShell
        title="Browser"
        detail={part.errorMessage ?? "The agent’s browser did not start."}
        accessory={
          <span className="rounded-full bg-[#dc2626]/10 px-2 py-0.5 text-[10px] font-bold text-[#dc2626]">
            Error
          </span>
        }
      />
    );
  }

  if (status === "agent-asleep") {
    return (
      <WorkCardShell
        title={part.title}
        detail="Agent is asleep"
        accessory={
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
            Asleep
          </span>
        }
      />
    );
  }

  return (
    <WorkCardShell
      title={part.title}
      detail={browserLinkLabel(part.url)}
      onClick={() => agentId && setOpenBrowser(agentId, part.url)}
    />
  );
}
