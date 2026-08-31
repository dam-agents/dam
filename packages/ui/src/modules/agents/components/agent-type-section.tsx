import type { CarbonIconType } from "@carbon/icons-react";
import {
  Book,
  Chemistry,
  ContainerSoftware,
  IbmWatsonAssistant,
} from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { SectionLabel } from "@/components/ui/section-label";

import { CardGrid } from "../../sandboxes/components/card-list.js";
import {
  CardIconTile,
  StackedCard,
} from "../../sandboxes/components/steps/stacked-card.js";

export type AgentSetupType =
  | "coding"
  | "research"
  | "assistant"
  | "knowledge-base";

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function SlackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3.36 10.08a1.68 1.68 0 11-1.68-1.68h1.68v1.68zm.84 0a1.68 1.68 0 113.36 0v4.24a1.68 1.68 0 11-3.36 0v-4.24z" fill="#E01E5A" />
      <path d="M5.88 3.36a1.68 1.68 0 111.68-1.68v1.68H5.88zm0 .84a1.68 1.68 0 110 3.36H1.68a1.68 1.68 0 110-3.36h4.2z" fill="#36C5F0" />
      <path d="M12.64 5.88a1.68 1.68 0 111.68 1.68h-1.68V5.88zm-.84 0a1.68 1.68 0 11-3.36 0V1.68a1.68 1.68 0 113.36 0v4.2z" fill="#2EB67D" />
      <path d="M10.12 12.64a1.68 1.68 0 11-1.68 1.68v-1.68h1.68zm0-.84a1.68 1.68 0 110-3.36h4.2a1.68 1.68 0 110 3.36h-4.2z" fill="#ECB22E" />
    </svg>
  );
}

interface AgentTypeOption {
  type: AgentSetupType;
  icon: CarbonIconType;
  title: string;
  description: string;
  tags: ReactNode;
}

export const AGENT_TYPES: AgentTypeOption[] = [
  {
    type: "coding",
    icon: ContainerSoftware,
    title: "Coding",
    description:
      "Run a coding agent with your preferred harness and tools in an isolated environment.",
    tags: (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="muted" className="gap-1.5">
          <GitHubIcon /> GitHub
        </Badge>
      </div>
    ),
  },
  {
    type: "research",
    icon: Chemistry,
    title: "Research",
    description:
      "Run research frameworks like Nous or OpenEvolve to explore and iterate.",
    tags: (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="muted">Nous, OpenEvolve, +3 more</Badge>
      </div>
    ),
  },
  {
    type: "assistant",
    icon: IbmWatsonAssistant,
    title: "Assistant",
    description:
      "An assistant you or your team can use collaboratively in Slack for your daily work.",
    tags: (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="muted" className="gap-1.5">
          <SlackIcon /> Slack
        </Badge>
      </div>
    ),
  },
  {
    type: "knowledge-base",
    icon: Book,
    title: "Knowledge Base",
    description:
      "Organize and converse with structured knowledge from repos, documents, and more.",
    tags: (
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="muted">LLM Wiki</Badge>
        <Badge variant="muted">Plain Wiki</Badge>
      </div>
    ),
  },
];

interface Props {
  selected: AgentSetupType | null;
  onSelect: (type: AgentSetupType) => void;
}

export function AgentTypeSection({ selected, onSelect }: Props) {
  return (
    <section className="mb-8">
      <SectionLabel spaced>Agent type</SectionLabel>
      <CardGrid>
        {AGENT_TYPES.map((option) => (
          <StackedCard
            key={option.type}
            icon={<CardIconTile icon={option.icon} />}
            title={option.title}
            description={option.description}
            footer={option.tags}
            selected={selected === option.type}
            onSelect={() => onSelect(option.type)}
            testId={`agent-type-card-${option.type}`}
          />
        ))}
      </CardGrid>
    </section>
  );
}
