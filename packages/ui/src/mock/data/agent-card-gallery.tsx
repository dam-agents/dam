import { PageHeader } from "@/components/ui/page-header";

import { AgentRow } from "../../modules/agents/components/agent-row.js";
import { resolveAgentDisplay } from "../../modules/agents/utils/agent-resolver.js";
import { PACKS } from "../../modules/packs/data/packs.js";
import { useStore } from "../../store.js";
import type { AgentView } from "../../types.js";
import {
  allFixtureAgents,
  bareAgent,
  demoPackAgent,
  errorAgent,
  experimentAgent,
  fixtureSchedules,
  fullAgent,
  hibernatedUnknownSkills,
  knowledgeBaseAgent,
  neverHibernatesButHibernated,
  neverHibernatesOverBudget,
  packSkippedAgent,
  singularAgent,
  temporaryDriverAgent,
} from "./agent-card-fixtures.js";

const onboardingPack = PACKS.find((p) => p.id === "docs-maintainer")!;
if (onboardingPack && bareAgent) {
  const store = useStore.getState();
  if (!store.onboardingByAgent.has(bareAgent.id)) {
    store.initOnboarding(bareAgent.id, onboardingPack);
    store.completeOnboardingStep(
      bareAgent.id,
      `connect-${onboardingPack.required[0]?.label}`,
    );
  }
}

function StateLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[15px] font-medium text-purple-600/60 dark:text-purple-400/60">
      {children}
    </p>
  );
}

const noop = () => {};

function CardDemo({ agent, label }: { agent: AgentView; label: string }) {
  const display = resolveAgentDisplay(agent, new Set(), new Set());
  const scheduleCount = fixtureSchedules.filter(
    (s) => s.agentId === agent.id,
  ).length;
  return (
    <div className="flex flex-col gap-3">
      <StateLabel>{label}</StateLabel>
      <AgentRow
        agent={agent}
        display={display}
        deletePending={false}
        onSelect={noop}
        onConfigure={noop}
        configureLabel="Configure"
        onWake={noop}
        onRestart={noop}
        onPause={noop}
        onStop={noop}
        onDelete={noop}
        onAddToSlack={noop}
        onAddToTelegram={noop}
        scheduleCount={scheduleCount}
      />
    </div>
  );
}

export function AgentCardGallery() {
  document.title = "Card Gallery";
  return (
    <div>
      <PageHeader
        title="Production card designs"
        description="Every card state from prod rendered side by side. Review each one to decide what stays or changes."
      />

      <div className="flex flex-col gap-8">
        <CardDemo agent={fullAgent} label="§5-1 Full card — slack, schedules" />
        <CardDemo
          agent={bareAgent}
          label="§5-2 Bare card — nothing attached (+ Onboarding 1/3 tag)"
        />
        <CardDemo
          agent={singularAgent}
          label="§5-3 One-of-each — singular forms"
        />
        <CardDemo
          agent={hibernatedUnknownSkills}
          label="§5-4 Hibernated, unknown skills"
        />
        <CardDemo
          agent={neverHibernatesButHibernated}
          label="§5-5a Never-hibernates but stopped"
        />
        <CardDemo
          agent={neverHibernatesOverBudget}
          label="§5-5b Never-hibernates, over budget"
        />
        <CardDemo agent={knowledgeBaseAgent} label="§5-6 Knowledge base" />
        <CardDemo agent={experimentAgent} label="§5-7 Experiment" />
        <CardDemo
          agent={packSkippedAgent}
          label="§5-8 Pack applied, partly skipped"
        />
        <CardDemo agent={errorAgent} label="§5-9 Error state" />
        <CardDemo
          agent={temporaryDriverAgent}
          label="§5-10 Temporary-agent driver"
        />
        <CardDemo agent={demoPackAgent} label="§5-11 Pack agent" />
      </div>
    </div>
  );
}
