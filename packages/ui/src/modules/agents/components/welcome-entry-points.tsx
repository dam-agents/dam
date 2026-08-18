import {
  ArrowRight,
  Book,
  type CarbonIconType,
  Chemistry,
  ContainerSoftware,
} from "@carbon/icons-react";
import type { EntryPointChoice } from "api-server-api";

import { Callout } from "@/components/ui/callout";
import { CardButton } from "@/components/ui/card-button";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../brand.js";
import { DOCS_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import type { StartingPoint } from "../../sandboxes/lib/wizard-snapshot.js";
import { useRecordEntryPoint } from "../../usage/api/mutations.js";

interface EntryPoint {
  choice: EntryPointChoice;
  setupView?: "experiment-new" | "knowledge-base-new";
  startingPoint?: StartingPoint;
  icon: CarbonIconType;
  title: string;
  description: string;
}

const ENTRY_POINTS: EntryPoint[] = [
  {
    choice: "sandbox",
    startingPoint: "general-purpose",
    icon: ContainerSoftware,
    title: "Create a coding agent",
    description:
      "Work with your preferred coding agent, credentials, and tools in an isolated environment.",
  },
  {
    choice: "experiment",
    setupView: "experiment-new",
    icon: Chemistry,
    title: "Begin an experiment",
    description:
      "Run one goal across many variants at once and compare results.",
  },
  {
    choice: "knowledge-base",
    setupView: "knowledge-base-new",
    icon: Book,
    title: "Start a knowledge base",
    description:
      "Organize and converse with data sourced from repos, documents, and more (LLM wiki).",
  },
];

export function WelcomeEntryPoints() {
  const navigateToCreateSandbox = useStore((s) => s.navigateToCreateSandbox);
  const setView = useStore((s) => s.setView);
  const recordEntryPoint = useRecordEntryPoint();

  const enter = (entryPoint: EntryPoint) => {
    recordEntryPoint.mutate({ choice: entryPoint.choice });
    if (entryPoint.setupView) {
      setView(entryPoint.setupView);
      return;
    }
    navigateToCreateSandbox(entryPoint.startingPoint);
  };

  return (
    <Callout tone="gradient" className="p-6 anim-in">
      <h2 className="text-lg font-semibold text-foreground">
        Accelerate research with {getBrand().name}
      </h2>
      <p className="mt-1.5 max-w-[560px] text-sm leading-relaxed text-muted-foreground">
        Run agents in isolated cloud environments with credentials and tools
        securely injected. Create knowledge bases, run experiments to compare
        agent variants, and trigger agents from Slack or on a schedule.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
        {ENTRY_POINTS.map((entryPoint) => (
          <EntryPointCard
            key={entryPoint.choice}
            entryPoint={entryPoint}
            onSelect={() => enter(entryPoint)}
          />
        ))}
      </div>

      <div className="mt-5 flex justify-end">
        <a
          href={DOCS_URL}
          {...externalLinkProps}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
        >
          Or check out the Documentation
          <ArrowRight size={16} className="shrink-0" />
        </a>
      </div>
    </Callout>
  );
}

function EntryPointCard({
  entryPoint: { icon: Icon, title, description },
  onSelect,
}: {
  entryPoint: EntryPoint;
  onSelect: () => void;
}) {
  return (
    <CardButton
      onClick={onSelect}
      className="flex h-full flex-col items-start gap-3 p-4"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
        <Icon size={22} className="text-muted-foreground" />
      </span>
      <span className="min-w-0">
        <span className="block text-base font-medium leading-[1.2] text-foreground">
          {title}
        </span>
        <span className="mt-1 block text-sm leading-snug text-muted-foreground">
          {description}
        </span>
      </span>
    </CardButton>
  );
}
