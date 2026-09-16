import type { EntryPointChoice } from "api-server-api";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import { useRecordEntryPoint } from "../../usage/api/mutations.js";

interface Nav {
  setView: (view: "coding-agent-new" | "knowledge-base-new") => void;
  navigateToStarterKits: (category?: "knowledge") => void;
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
  go: (nav) => nav.navigateToStarterKits(),
};

const KNOWLEDGE_BASE_FROM_TEMPLATE: EntryPoint = {
  choice: "knowledge-base",
  label: "Start a knowledge base",
  go: (nav) => nav.setView("knowledge-base-new"),
};

const KNOWLEDGE_BASE_FROM_KITS: EntryPoint = {
  choice: "starter-kit",
  label: "Create knowledge base agent",
  go: (nav) => nav.navigateToStarterKits("knowledge"),
};

const KNOWLEDGE_BASE_ONLY: EntryPoint = {
  ...KNOWLEDGE_BASE_FROM_TEMPLATE,
  label: "Create knowledge base agent",
};

function useEnter() {
  const setView = useStore((s) => s.setView);
  const navigateToStarterKits = useStore((s) => s.navigateToStarterKits);
  const recordEntryPoint = useRecordEntryPoint();
  return (entryPoint: EntryPoint) => {
    recordEntryPoint.mutate({ choice: entryPoint.choice });
    entryPoint.go({ setView, navigateToStarterKits });
  };
}

function entryPointsFor(
  surface: "home" | "knowledge-bases",
  kitsEnabled: boolean,
): EntryPoint[] {
  if (surface === "knowledge-bases")
    return [kitsEnabled ? KNOWLEDGE_BASE_FROM_KITS : KNOWLEDGE_BASE_ONLY];
  return kitsEnabled
    ? [BROWSE_KITS, CREATE_AGENT]
    : [CREATE_AGENT, KNOWLEDGE_BASE_FROM_TEMPLATE];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The ways into creating something, as buttons.
 * Home offers the catalog and a plain agent; the Knowledge Bases surface
 * offers only a knowledge base, which with kits on means the knowledge shelf
 * of the catalog. With kits off each falls back to the template flows, so no
 * install loses an entry point.
 */
export function EntryPointButtons({
  surface,
}: {
  surface: "home" | "knowledge-bases";
}) {
  const kitsEnabled = useFeatures().data?.["starter-kits"] ?? false;
  const enter = useEnter();
  const [lead, second] = entryPointsFor(surface, kitsEnabled);
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
    </>
  );
}

export function useCreateKnowledgeBase(): () => void {
  const kitsEnabled = useFeatures().data?.["starter-kits"] ?? false;
  const enter = useEnter();
  return () =>
    enter(kitsEnabled ? KNOWLEDGE_BASE_FROM_KITS : KNOWLEDGE_BASE_ONLY);
}
