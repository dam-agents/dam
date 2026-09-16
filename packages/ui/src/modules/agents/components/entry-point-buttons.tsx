import type { EntryPointChoice } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import { BrowseKitsModal } from "../../starter-kits/components/browse-kits-modal.js";
import type { Filter } from "../../starter-kits/components/kit-browser.js";
import { useRecordEntryPoint } from "../../usage/api/mutations.js";

interface Nav {
  setView: (view: "coding-agent-new" | "knowledge-base-new") => void;
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
  go: (nav) => nav.setView("coding-agent-new"),
};

const BROWSE_KITS: EntryPoint = {
  choice: "starter-kit",
  label: "Browse starter kits",
  go: (nav) => nav.browseKits("all"),
};

const KNOWLEDGE_BASE_FROM_TEMPLATE: EntryPoint = {
  choice: "knowledge-base",
  label: "Start a knowledge base",
  go: (nav) => nav.setView("knowledge-base-new"),
};

const KNOWLEDGE_BASE_FROM_KITS: EntryPoint = {
  choice: "starter-kit",
  label: "Create knowledge base agent",
  go: (nav) => nav.browseKits("knowledge"),
};

const KNOWLEDGE_BASE_ONLY: EntryPoint = {
  ...KNOWLEDGE_BASE_FROM_TEMPLATE,
  label: "Create knowledge base agent",
};

function useEnter(browseKits: (shelf: Filter) => void) {
  const setView = useStore((s) => s.setView);
  const recordEntryPoint = useRecordEntryPoint();
  return (entryPoint: EntryPoint) => {
    recordEntryPoint.mutate({ choice: entryPoint.choice });
    entryPoint.go({ setView, browseKits });
  };
}

function entryPointsFor(
  surface: "home" | "knowledge-bases",
  kitsEnabled: boolean,
  primary: "kits" | "agent",
): EntryPoint[] {
  if (surface === "knowledge-bases")
    return [kitsEnabled ? KNOWLEDGE_BASE_FROM_KITS : KNOWLEDGE_BASE_ONLY];
  if (!kitsEnabled) return [CREATE_AGENT, KNOWLEDGE_BASE_FROM_TEMPLATE];
  return primary === "agent"
    ? [CREATE_AGENT, BROWSE_KITS]
    : [BROWSE_KITS, CREATE_AGENT];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The ways into creating something, as buttons.
 * Home offers the catalog and a plain agent; the Knowledge Bases surface
 * offers only a knowledge base, which with kits on means the knowledge shelf
 * of the catalog. The catalog opens as the Browse Kits modal over the current
 * page — the same modal the setup page's Change button opens — and a pick
 * goes straight to that kit's setup. With kits off each entry falls back to
 * the template flows, so no install loses an entry point.
 */
export function EntryPointButtons({
  surface,
  primary = "kits",
}: {
  surface: "home" | "knowledge-bases";
  primary?: "kits" | "agent";
}) {
  const kitsEnabled = useFeatures().data?.["starter-kits"] ?? false;
  const setView = useStore((s) => s.setView);
  const navigateToStarterKit = useStore((s) => s.navigateToStarterKit);
  const [browsing, setBrowsing] = useState<Filter | null>(null);
  const enter = useEnter(setBrowsing);
  const [lead, second] = entryPointsFor(surface, kitsEnabled, primary);
  if (!lead) return null;
  return (
    <>
      <Button onClick={() => enter(lead)} data-testid="entry-point-lead">
        {lead.label}
      </Button>
      {second && (
        <Button
          variant="outline"
          onClick={() => enter(second)}
          data-testid="entry-point-second"
        >
          {second.label}
        </Button>
      )}
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
            setView("coding-agent-new");
          }}
        />
      )}
    </>
  );
}

export function useCreateKnowledgeBase(): () => void {
  const kitsEnabled = useFeatures().data?.["starter-kits"] ?? false;
  const navigateToStarterKits = useStore((s) => s.navigateToStarterKits);
  const enter = useEnter((shelf) =>
    navigateToStarterKits(shelf === "knowledge" ? "knowledge" : undefined),
  );
  return () =>
    enter(kitsEnabled ? KNOWLEDGE_BASE_FROM_KITS : KNOWLEDGE_BASE_ONLY);
}
