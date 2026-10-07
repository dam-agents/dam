import type { EntryPointChoice } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { BrowseKitsModal } from "../../starter-kits/components/browse-kits-modal.js";
import type { Filter } from "../../starter-kits/components/kit-browser.js";
import { useRecordEntryPoint } from "../../usage/api/mutations.js";

interface Nav {
  setView: (view: "agent-new") => void;
  browseKits: (shelf: Filter) => void;
}

interface EntryPoint {
  choice: EntryPointChoice;
  label: string;
  go: (nav: Nav) => void;
}

const CREATE_AGENT: EntryPoint = {
  choice: "sandbox",
  label: "Create agent",
  go: (nav) => nav.setView("agent-new"),
};

const BROWSE_KITS: EntryPoint = {
  choice: "starter-kit",
  label: "Browse starter kits",
  go: (nav) => nav.browseKits("all"),
};

const CREATE_AGENT_FROM_KITS: EntryPoint = {
  ...BROWSE_KITS,
  label: "Create agent",
};

function useEnter(browseKits: (shelf: Filter) => void) {
  const setView = useStore((s) => s.setView);
  const recordEntryPoint = useRecordEntryPoint();
  return (entryPoint: EntryPoint) => {
    recordEntryPoint.mutate({ choice: entryPoint.choice });
    entryPoint.go({ setView, browseKits });
  };
}

type Surface = "home" | "welcome";

function entryPointsFor(
  surface: Surface,
  primary: "kits" | "agent",
): EntryPoint[] {
  if (surface === "welcome") return [CREATE_AGENT_FROM_KITS];
  return primary === "agent"
    ? [CREATE_AGENT, BROWSE_KITS]
    : [BROWSE_KITS, CREATE_AGENT];
}

export function EntryPointButtons({
  surface,
  primary = "kits",
}: {
  surface: Surface;
  primary?: "kits" | "agent";
}) {
  const setView = useStore((s) => s.setView);
  const navigateToStarterKit = useStore((s) => s.navigateToStarterKit);
  const [browsing, setBrowsing] = useState<Filter | null>(null);
  const enter = useEnter(setBrowsing);
  const [lead, second] = entryPointsFor(surface, primary);
  if (!lead) return null;
  return (
    <>
      {second && (
        <Button
          variant="outline"
          onClick={() => enter(second)}
          data-testid="entry-point-second"
        >
          {second.label}
        </Button>
      )}
      <Button onClick={() => enter(lead)} data-testid="entry-point-lead">
        {lead.label}
      </Button>
      {browsing && (
        <BrowseKitsModal
          initialFilter={browsing}
          onPick={(catalog, kitId) => {
            setBrowsing(null);
            navigateToStarterKit(catalog, kitId);
          }}
          onClose={() => setBrowsing(null)}
          onStartFromScratch={() => {
            setBrowsing(null);
            setView("agent-new");
          }}
        />
      )}
    </>
  );
}
