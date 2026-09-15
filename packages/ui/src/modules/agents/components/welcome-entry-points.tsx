import { ArrowRight } from "@carbon/icons-react";
import type { EntryPointChoice } from "api-server-api";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../brand.js";
import { DOCS_URL } from "../../../constants.js";
import { useStore } from "../../../store.js";
import { useFeatures } from "../../features/api/queries.js";
import { useRecordEntryPoint } from "../../usage/api/mutations.js";

type SetupView = "coding-agent-new" | "knowledge-base-new" | "starter-kits";

interface EntryPoint {
  choice: EntryPointChoice;
  setupView: SetupView;
  label: string;
}

const CREATE_AGENT: EntryPoint = {
  choice: "sandbox",
  setupView: "coding-agent-new",
  label: "Create agent",
};

const BROWSE_KITS: EntryPoint = {
  choice: "starter-kit",
  setupView: "starter-kits",
  label: "Browse starter kits",
};

const KNOWLEDGE_BASE: EntryPoint = {
  choice: "knowledge-base",
  setupView: "knowledge-base-new",
  label: "Start a knowledge base",
};

export function WelcomeEntryPoints() {
  const setView = useStore((s) => s.setView);
  const recordEntryPoint = useRecordEntryPoint();
  const kitsEnabled = useFeatures().data?.["starter-kits"] ?? false;

  const enter = (entryPoint: EntryPoint) => {
    recordEntryPoint.mutate({ choice: entryPoint.choice });
    setView(entryPoint.setupView);
  };

  const [lead, second] = kitsEnabled
    ? [BROWSE_KITS, CREATE_AGENT]
    : [CREATE_AGENT, KNOWLEDGE_BASE];

  return (
    <Callout tone="gradient" className="p-6 anim-in">
      <h2 className="text-lg font-semibold text-foreground">
        Accelerate research with {getBrand().name}
      </h2>
      <p className="mt-1.5 max-w-[560px] text-sm leading-relaxed text-muted-foreground">
        Run agents in isolated cloud environments with credentials and tools
        securely injected. Start from a ready-made kit or build your own, and
        trigger agents from Slack or on a schedule.
      </p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button onClick={() => enter(lead)} data-testid="welcome-lead">
          {lead.label}
        </Button>
        <Button
          variant="outline"
          onClick={() => enter(second)}
          data-testid="welcome-second"
        >
          {second.label}
        </Button>
        <a
          href={DOCS_URL}
          {...externalLinkProps}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline md:ml-auto"
        >
          Or check out the Documentation
          <ArrowRight size={16} className="shrink-0" />
        </a>
      </div>
    </Callout>
  );
}
