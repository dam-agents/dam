import type { CarbonIconType } from "@carbon/icons-react";
import {
  Box,
  Chat,
  Code,
  Debug,
  Document,
  FlashFilled,
  Notebook,
  Settings,
} from "@carbon/icons-react";

export const INGREDIENT_KINDS = [
  "harness",
  "framework",
  "connection",
  "channel",
  "schedule",
  "skill",
  "knowledge-base",
  "starter-repo",
  "artifact",
] as const;

export type PackIngredientKind = (typeof INGREDIENT_KINDS)[number];

export const INGREDIENT_LABELS: Record<PackIngredientKind, string> = {
  harness: "Harness",
  framework: "Framework",
  connection: "Connection",
  channel: "Channel",
  schedule: "Schedule",
  skill: "Skill",
  "knowledge-base": "Knowledge base",
  "starter-repo": "Starter repo",
  artifact: "Artifact",
};

export interface PackSlot {
  kind: PackIngredientKind;
  label: string;
  description: string;
  templateId?: string;
  demoValue?: string;
  connectionTemplateId?: string;
  starterRepoUrl?: string;
}

export const PACK_CATEGORIES = [
  "Development",
  "Knowledge",
  "Monitoring",
  "Research",
] as const;

export type PackCategory = (typeof PACK_CATEGORIES)[number];

export interface Pack {
  id: string;
  name: string;
  tagline: string;
  description: string;
  icon: CarbonIconType;
  category: PackCategory;
  included: PackSlot[];
  required: PackSlot[];
}

export const PACKS: Pack[] = [
  {
    id: "docs-maintainer",
    name: "Docs Maintainer",
    category: "Development",
    icon: Box,
    tagline:
      "Keeps a docs site in step with the code and publishes it on a schedule.",
    description:
      "Watches your repository for code changes that affect documentation. Automatically updates API references, changelogs, and guides, then publishes the docs site on a configurable schedule. Pairs with a GitHub connection for repo access and a release-triggered schedule to keep docs always current.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description:
          "Reads code changes and rewrites affected docs pages with accurate examples",
        templateId: "claude-code",
      },
      {
        kind: "skill",
        label: "Docs generator",
        description:
          "Extracts API signatures, types, and usage patterns into structured documentation",
      },
      {
        kind: "skill",
        label: "Changelog writer",
        description:
          "Summarizes merged PRs into release notes grouped by category",
      },
      {
        kind: "schedule",
        label: "On every release",
        description:
          "Triggers a full docs rebuild and publish after each tagged release",
        demoValue: "RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=0",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description: "Read source code, PRs, and release tags",
        templateId: "github",
        connectionTemplateId: "conn-tpl-github",
      },
      {
        kind: "channel",
        label: "Docs updates channel",
        description:
          "Post publish notifications and changelog summaries to Slack",
        demoValue: "#docs-updates",
      },
    ],
  },
  {
    id: "design-prototyper",
    name: "Design Prototyper",
    category: "Development",
    icon: Notebook,
    tagline:
      "Reads GitHub issues and builds interactive prototypes with your design system",
    description:
      "Connects to your repository, watches for design-tagged issues, and generates interactive prototypes. Pairs with a knowledge base of your design tokens and component library for consistent output.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description:
          "Generates and iterates on prototype code from issue descriptions",
        templateId: "claude-code",
      },
      {
        kind: "skill",
        label: "Prototyper",
        description:
          "Turns issue specs into interactive HTML/React prototypes using your tokens",
      },
      {
        kind: "skill",
        label: "Design system reader",
        description:
          "Parses your repo's tokens, components, and usage patterns so prototypes match your system",
      },
      {
        kind: "schedule",
        label: "Issue scan",
        description: "Checks for new design-tagged issues every 30 minutes",
        demoValue: "RRULE:FREQ=MINUTELY;INTERVAL=30",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description: "Read issues, PRs, and repo files",
        templateId: "github",
        connectionTemplateId: "conn-tpl-github",
        demoValue: "acme-org/design-system",
      },
      {
        kind: "knowledge-base",
        label: "Design system docs",
        description:
          "Your design tokens, component library, and brand guidelines",
      },
    ],
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    category: "Development",
    icon: Code,
    tagline:
      "Reviews pull requests against your coding standards automatically",
    description:
      "Watches your repository for new pull requests and runs automated code review. Checks style, flags security issues, audits dependencies, and posts review comments directly on the PR.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description:
          "Reads diffs and writes review comments with inline code suggestions",
        templateId: "claude-code",
      },
      {
        kind: "skill",
        label: "Code review",
        description:
          "Enforces your style guide, flags security issues, and suggests fixes inline",
      },
      {
        kind: "skill",
        label: "Dependency audit",
        description:
          "Scans lockfiles for outdated or vulnerable packages on every review",
      },
      {
        kind: "schedule",
        label: "Nightly audit",
        description: "Full security scan of changed files, daily at 2 AM",
        demoValue: "RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=0",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description: "Read PRs, diffs, and CI status",
        templateId: "github",
        connectionTemplateId: "conn-tpl-github",
      },
      {
        kind: "knowledge-base",
        label: "Team standards",
        description: "Your coding conventions and review checklist",
      },
    ],
  },
  {
    id: "codebase-qa",
    name: "Codebase Q&A",
    category: "Knowledge",
    icon: Chat,
    tagline:
      "Indexes your repository and answers questions about your codebase",
    description:
      "Connects to your repo and builds a searchable index of your code, architecture, and documentation. Ask questions in chat or through a channel and get answers grounded in your actual codebase.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description:
          "Navigates your codebase to find and explain code in context",
        templateId: "claude-code",
      },
      {
        kind: "skill",
        label: "Codebase indexer",
        description:
          "Builds a searchable map of your repository structure, docs, and patterns",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description: "Read repository files and history",
        templateId: "github",
        connectionTemplateId: "conn-tpl-github",
      },
      {
        kind: "knowledge-base",
        label: "Codebase docs",
        description: "Architecture docs, ADRs, and onboarding guides",
      },
      {
        kind: "channel",
        label: "Team channel",
        description: "Route questions from your team to this agent",
        demoValue: "#eng-questions",
      },
    ],
  },
  {
    id: "broken-link-monitor",
    name: "Broken Link Monitor",
    category: "Monitoring",
    icon: Debug,
    tagline: "Scans your sites for broken links and reports them daily",
    description:
      "Uses the link-guardian starter repo to crawl your sites on a schedule. Reports broken links, redirects, and SSL issues. Sends alerts through your preferred channel.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description:
          "Interprets crawl results and writes actionable reports with fix suggestions",
        templateId: "claude-code",
      },
      {
        kind: "starter-repo",
        label: "Link Guardian",
        description:
          "Crawls configured sites and detects broken links, redirects, and SSL issues",
        templateId: "link-guardian",
      },
      {
        kind: "skill",
        label: "Link reporter",
        description:
          "Formats raw crawl output into prioritized, actionable reports",
      },
      {
        kind: "schedule",
        label: "Daily scan",
        description: "Crawls all configured sites daily at 6 AM",
        demoValue: "RRULE:FREQ=DAILY;BYHOUR=6;BYMINUTE=0",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description: "Store scan results and configuration",
        templateId: "github",
        connectionTemplateId: "conn-tpl-github",
      },
      {
        kind: "channel",
        label: "Alert channel",
        description: "Receive broken-link alerts in Slack or Telegram",
        demoValue: "#site-health",
      },
    ],
  },
  {
    id: "research-paper-scanner",
    name: "Research Paper Scanner",
    category: "Research",
    icon: Document,
    tagline: "Monitors arXiv for papers matching your research interests",
    description:
      "Uses the arxiv-scanner starter repo to watch for new papers in your areas of interest. Summarizes findings, extracts key results, and maintains a knowledge base of relevant literature.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description:
          "Reads full papers and writes structured summaries of methods and results",
        templateId: "claude-code",
      },
      {
        kind: "starter-repo",
        label: "arXiv Scanner",
        description:
          "Watches arXiv feeds and filters papers by your configured topics",
        templateId: "arxiv-scanner",
      },
      {
        kind: "skill",
        label: "Paper summarizer",
        description:
          "Extracts key findings, methods, and results into a consistent format",
      },
      {
        kind: "schedule",
        label: "Daily scan",
        description: "Checks for new papers daily at 7 AM",
        demoValue: "RRULE:FREQ=DAILY;BYHOUR=7;BYMINUTE=0",
      },
    ],
    required: [
      {
        kind: "knowledge-base",
        label: "Research topics",
        description: "Your areas of interest, key authors, and reading notes",
      },
    ],
  },
  {
    id: "optimization-campaign",
    name: "Optimization Campaign",
    category: "Research",
    icon: FlashFilled,
    tagline: "Runs evolutionary code optimization on GPU with OpenEvolve",
    description:
      "Sets up an OpenEvolve optimization campaign that evolves code solutions using LLM-guided mutations. Connects to Modal for GPU evaluation and tracks optimization progress across generations.",
    included: [
      {
        kind: "framework",
        label: "OpenEvolve",
        description:
          "Evolves code solutions through LLM-guided mutations across generations",
        templateId: "openevolve",
      },
      {
        kind: "skill",
        label: "Benchmark runner",
        description:
          "Executes fitness evaluations on GPU and tracks optimization metrics",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "Modal",
        description: "GPU compute for fitness evaluation",
        templateId: "modal",
        demoValue: "modal-workspace",
      },
    ],
  },
  {
    id: "kitchen-sink",
    name: "Preset Name",
    category: "Development",
    icon: Settings,
    tagline: "Short tagline describing what this preset does in one sentence",
    description:
      "Longer description that explains the full scope of this preset. This paragraph appears in the detail sheet and gives users context about how the pieces fit together and what outcome to expect.",
    included: [
      {
        kind: "harness",
        label: "Harness Name",
        description: "Included harness description text",
        templateId: "claude-code",
      },
      {
        kind: "framework",
        label: "Framework Name",
        description: "Included framework description text",
        templateId: "openevolve",
      },
      {
        kind: "skill",
        label: "Skill One",
        description: "First included skill description text",
      },
      {
        kind: "skill",
        label: "Skill Two",
        description: "Second included skill description text",
      },
      {
        kind: "schedule",
        label: "Schedule One",
        description: "Included schedule description text",
        demoValue: "RRULE:FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
      },
      {
        kind: "starter-repo",
        label: "Starter Repo Name",
        description: "Included starter repo description text",
        templateId: "starter-example",
      },
      {
        kind: "artifact",
        label: "Artifact Name",
        description: "Included artifact description text",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description: "Required connection description text",
        templateId: "github",
        connectionTemplateId: "conn-tpl-github",
      },
      {
        kind: "connection",
        label: "Slack",
        description: "Second required connection description text",
        templateId: "slack",
      },
      {
        kind: "channel",
        label: "Channel Name",
        description: "Required channel description text",
        demoValue: "#example-channel",
      },
      {
        kind: "knowledge-base",
        label: "Knowledge Base Name",
        description: "Required knowledge base description text",
      },
      {
        kind: "schedule",
        label: "Schedule Two",
        description: "Required schedule description text",
        demoValue: "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=14;BYMINUTE=0",
      },
      {
        kind: "skill",
        label: "Skill Three",
        description: "Required skill that the user adds during setup",
      },
    ],
  },
];
