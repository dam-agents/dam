import type { CarbonIconType } from "@carbon/icons-react";
import { Chat, Code, Document, Education, Help } from "@carbon/icons-react";
import type { KnowledgeBaseTemplateId } from "api-server-api";

export interface KbIntent {
  id: string;
  title: string;
  tagline: string;
  outcome: string;
  icon: CarbonIconType;
  recommendedConnections: string[];
  suggestedType: KnowledgeBaseTemplateId;
}

export const KB_INTENTS: readonly KbIntent[] = [
  {
    id: "repo",
    title: "Keep a codebase documented",
    tagline: "Point it at a repo and get a living wiki",
    outcome:
      "A structured wiki that stays in sync with your code. The knowledge base reads your repository, extracts architecture, APIs, and patterns, then organizes them into browsable documentation you can query in chat.",
    icon: Code,
    recommendedConnections: ["github"],
    suggestedType: "llm-wiki",
  },
  {
    id: "team-qa",
    title: "Answer questions about how we work",
    tagline: "Feed it your docs and let the team ask questions",
    outcome:
      "A team Q&A bot grounded in your actual documentation. Connect your internal docs, runbooks, and processes so anyone can get answers without hunting through wikis or pinging the on-call.",
    icon: Chat,
    recommendedConnections: ["github", "slack"],
    suggestedType: "llm-wiki",
  },
  {
    id: "onboarding",
    title: "Onboard new team members",
    tagline: "A knowledge base that answers “how do we do X here?”",
    outcome:
      "An onboarding companion that knows your team’s stack, conventions, and workflows. New hires ask questions in chat and get answers drawn from your actual setup guides, architecture docs, and team norms.",
    icon: Education,
    recommendedConnections: ["github"],
    suggestedType: "llm-wiki",
  },
  {
    id: "support",
    title: "Help users troubleshoot",
    tagline: "Turn support docs into an interactive troubleshooting guide",
    outcome:
      "A support knowledge base that walks users through solutions step by step. Feed it your troubleshooting guides, FAQs, and known issues so it can diagnose problems and suggest fixes grounded in your documentation.",
    icon: Help,
    recommendedConnections: ["github"],
    suggestedType: "plain-wiki",
  },
  {
    id: "docs",
    title: "Maintain a knowledge hub",
    tagline: "Collect and organize knowledge from anywhere",
    outcome:
      "A general-purpose knowledge hub you build over time. Add sources manually, point it at repos or docs, and chat with it to find what you need. Works as a lightweight wiki without heavy indexing.",
    icon: Document,
    recommendedConnections: [],
    suggestedType: "plain-wiki",
  },
];

export function getIntent(id: string): KbIntent | undefined {
  return KB_INTENTS.find((i) => i.id === id);
}
