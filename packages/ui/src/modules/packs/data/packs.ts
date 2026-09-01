import type { CarbonIconType } from "@carbon/icons-react";
import {
  Chat,
  Code,
  Debug,
  Document,
  FlashFilled,
  Notebook,
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
        description: "AI coding harness for generating and iterating on code",
        templateId: "claude-code",
      },
      {
        kind: "skill",
        label: "Prototyper",
        description:
          "Generates interactive HTML/React prototypes from issue specs",
      },
      {
        kind: "skill",
        label: "Design system reader",
        description:
          "Parses tokens, components, and usage patterns from your repo",
      },
      {
        kind: "schedule",
        label: "Issue scan",
        description: "Checks for new issues tagged 'design' every 30 minutes",
        demoValue: "*/30 * * * *",
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
        description: "AI coding harness for generating and iterating on code",
        templateId: "claude-code",
      },
      {
        kind: "skill",
        label: "Code review",
        description:
          "Style checks, security scanning, and best-practice enforcement",
      },
      {
        kind: "skill",
        label: "Dependency audit",
        description: "Flags outdated or vulnerable packages in lockfiles",
      },
      {
        kind: "schedule",
        label: "Nightly audit",
        description: "Full security scan of changed files, daily at 2 AM",
        demoValue: "0 2 * * *",
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
        description: "AI coding harness for generating and iterating on code",
        templateId: "claude-code",
      },
      {
        kind: "skill",
        label: "Codebase indexer",
        description: "Indexes repository structure, docs, and code patterns",
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
        description: "AI coding harness for generating and iterating on code",
        templateId: "claude-code",
      },
      {
        kind: "starter-repo",
        label: "Link Guardian",
        description:
          "Crawls sites and detects broken links, redirects, and SSL issues",
        templateId: "link-guardian",
      },
      {
        kind: "skill",
        label: "Link reporter",
        description: "Formats scan results into actionable reports",
      },
      {
        kind: "schedule",
        label: "Daily scan",
        description: "Crawls all configured sites daily at 6 AM",
        demoValue: "0 6 * * *",
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
        description: "AI coding harness for generating and iterating on code",
        templateId: "claude-code",
      },
      {
        kind: "starter-repo",
        label: "arXiv Scanner",
        description: "Watches arXiv feeds and filters papers by topic",
        templateId: "arxiv-scanner",
      },
      {
        kind: "skill",
        label: "Paper summarizer",
        description: "Extracts key findings, methods, and results from papers",
      },
      {
        kind: "schedule",
        label: "Daily scan",
        description: "Checks for new papers daily at 7 AM",
        demoValue: "0 7 * * *",
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
        description: "Evolutionary code-optimization agent",
        templateId: "openevolve",
      },
      {
        kind: "skill",
        label: "Benchmark runner",
        description:
          "Executes fitness evaluations and tracks optimization metrics",
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
];
