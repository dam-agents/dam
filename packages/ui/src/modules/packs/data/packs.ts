import type { CarbonIconType } from "@carbon/icons-react";
import {
  Book,
  Box,
  Chat,
  Code,
  Debug,
  Document,
  FlashFilled,
  Idea,
  MachineLearning,
  Microscope,
  Notebook,
  Security,
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
  "file",
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
  file: "File",
};

export interface PackSlot {
  kind: PackIngredientKind;
  label: string;
  description?: string;
  templateId?: string;
  demoValue?: string;
  connectionTemplateId?: string;
  starterRepoUrl?: string;
}

export interface PackSchedule {
  id: string;
  label: string;
  description: string;
  cron?: string;
  defaultOn: boolean;
  heldUntil?: string;
}

export interface AgentChecklistItem {
  id: string;
  label: string;
  layer: 1 | 2;
  messageId?: string;
}

export const PACK_CATEGORIES = [
  "Software",
  "Productivity",
  "Knowledge",
  "Research",
  "Development",
  "Monitoring",
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
  sizeCpuMilli?: number;
  sizeMemoryMi?: number;
  onboarding?: boolean;
  schedules?: PackSchedule[];
  agentChecklist?: AgentChecklistItem[];
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
        connectionTemplateId: "github",
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
        connectionTemplateId: "github",
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
        connectionTemplateId: "github",
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
        connectionTemplateId: "github",
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
        connectionTemplateId: "github",
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
    name: "Starter Kit Name",
    category: "Development",
    icon: Settings,
    tagline:
      "Short tagline describing what this starter kit does in one sentence",
    description:
      "Longer description that explains the full scope of this starter kit. This paragraph appears in the detail sheet and gives users context about how the pieces fit together and what outcome to expect.",
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
        connectionTemplateId: "github",
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

export const REAL_PACKS: Pack[] = [
  {
    id: "code-guardian",
    name: "Code Reviewer",
    category: "Software",
    icon: Security,
    tagline:
      "Reviews every open pull request and nudges reviewers who go quiet.",
    description:
      "Watches your repositories for open pull requests, runs automated code review, and follows up with reviewers who haven't responded. Keeps your review queue moving so nothing goes stale.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description: "Reads diffs and writes review comments with context",
        templateId: "claude-code",
      },
      {
        kind: "skill",
        label: "Onboarding skill",
        description:
          "Walks you through initial setup and repository configuration",
      },
      {
        kind: "file",
        label: "CLAUDE.md",
        description:
          "Project instructions file that tells the agent how your repo works",
      },
      {
        kind: "file",
        label: "Onboarding.md",
        description:
          "Step-by-step guide that walks the agent through first-run setup",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description: "Read PRs, diffs, and reviewer activity",
        templateId: "github",
        connectionTemplateId: "github",
      },
      {
        kind: "connection",
        label: "GitHub Enterprise",
        description: "Read PRs, diffs, and reviewer activity",
        templateId: "github-enterprise",
        connectionTemplateId: "github-enterprise",
      },
    ],
    schedules: [
      {
        id: "pr-review",
        label: "PR review",
        description: "Checks open pull requests for new activity",
        cron: "Every 5 min",
        defaultOn: true,
      },
      {
        id: "reviewer-nudge",
        label: "Reviewer nudges",
        description: "Pings reviewers who haven't responded",
        cron: "Hourly on workdays",
        defaultOn: false,
        heldUntil: "connect-slack",
      },
      {
        id: "weekly-audit",
        label: "Weekly audit",
        description: "Full sweep of all open PRs",
        cron: "Fri 7:00",
        defaultOn: true,
      },
      {
        id: "monthly-bench",
        label: "Monthly benchmark",
        description: "Review quality metrics across the month",
        defaultOn: false,
      },
    ],
    agentChecklist: [
      {
        id: "connect-github",
        label: "Connect GitHub",
        layer: 1,
        messageId: "cg-m1",
      },
      {
        id: "backup-or-local",
        label: 'Backup repo, or say "local-only"',
        layer: 2,
        messageId: "cg-m4",
      },
      {
        id: "repo-to-review",
        label: "Repo to review",
        layer: 2,
        messageId: "cg-m6",
      },
      {
        id: "review-name",
        label: "Name to sign reviews with",
        layer: 2,
        messageId: "cg-m8",
      },
      {
        id: "re-review-label",
        label: "Re-review label",
        layer: 2,
        messageId: "cg-m10",
      },
      {
        id: "auto-merge",
        label: "Auto-merge on or off",
        layer: 2,
        messageId: "cg-m12",
      },
    ],
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
  {
    id: "personal-assistant",
    name: "Personal Assistant",
    category: "Productivity",
    icon: Chat,
    tagline:
      "Lives in your DMs, runs your briefing, and handles the small stuff.",
    description:
      "A persistent assistant that lives in Slack or Telegram. Runs a morning briefing, handles tasks you delegate, drafts messages, and answers questions — all in one conversation.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description: "Reads your messages and handles tasks in context",
        templateId: "claude-code",
      },
      {
        kind: "connection",
        label: "GitHub",
        description: "Lets the assistant update itself and back up",
        templateId: "github",
        connectionTemplateId: "github",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "Slack",
        description: "The conversation this assistant lives in",
        templateId: "slack",
        connectionTemplateId: "slack",
      },
      {
        kind: "connection",
        label: "Telegram",
        description: "The conversation this assistant lives in",
        templateId: "telegram",
        connectionTemplateId: "telegram",
      },
    ],
    schedules: [
      {
        id: "weekday-brief",
        label: "Weekday brief",
        description: "Morning summary of your day",
        cron: "Weekdays 8:00",
        defaultOn: true,
        heldUntil: "onboarding-done",
      },
      {
        id: "monday-review",
        label: "Monday review",
        description: "Week ahead overview",
        cron: "Mon 8:30",
        defaultOn: true,
        heldUntil: "onboarding-done",
      },
      {
        id: "friday-audit",
        label: "Friday audit",
        description: "Week-in-review wrap-up",
        cron: "Fri 7:00",
        defaultOn: true,
        heldUntil: "onboarding-done",
      },
    ],
    agentChecklist: [
      {
        id: "connect-channel",
        label: "Connect Slack or Telegram",
        layer: 1,
        messageId: "pa-m1",
      },
      { id: "who-i-am", label: "Who I am", layer: 2, messageId: "pa-m4" },
      {
        id: "what-i-do",
        label: "What I take care of",
        layer: 2,
        messageId: "pa-m6",
      },
      {
        id: "slack-member-id",
        label: "Slack member ID",
        layer: 2,
        messageId: "pa-m8",
      },
      {
        id: "may-message",
        label: "May I message first?",
        layer: 2,
        messageId: "pa-m10",
      },
      {
        id: "backup-local",
        label: "Backup or local-only",
        layer: 2,
        messageId: "pa-m12",
      },
    ],
  },
  {
    id: "quality-inspector",
    name: "Quality Inspector",
    category: "Software",
    icon: Microscope,
    tagline:
      "Tests every issue, runs nightly regressions, and benchmarks your product.",
    description:
      "Watches for new issues, writes and runs test scenarios, and maintains a regression suite. Runs nightly, weekly, and monthly checks so quality problems surface before users find them.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description: "Writes tests, runs scenarios, and reports results",
        templateId: "claude-code",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description: "Read issues, PRs, and test results",
        templateId: "github",
        connectionTemplateId: "github",
      },
    ],
    schedules: [
      {
        id: "issue-qa",
        label: "Issue QA",
        description: "Tests new issues as they come in",
        cron: "Hourly",
        defaultOn: true,
      },
      {
        id: "nightly-regression",
        label: "Nightly regression",
        description: "Full regression suite overnight",
        defaultOn: false,
      },
      {
        id: "monthly-bench",
        label: "Monthly benchmark",
        description: "Performance and quality benchmarks",
        defaultOn: false,
      },
      {
        id: "weekly-security",
        label: "Weekly security",
        description: "Security-focused test sweep",
        defaultOn: false,
      },
      {
        id: "weekly-scenarios",
        label: "Weekly scenarios",
        description: "End-to-end scenario coverage",
        defaultOn: false,
      },
    ],
    agentChecklist: [
      {
        id: "product-profile",
        label: "Product profile",
        layer: 2,
        messageId: "qi-m4",
      },
      { id: "backend", label: "Backend", layer: 2, messageId: "qi-m6" },
      {
        id: "target-repo",
        label: "Target repository",
        layer: 2,
        messageId: "qi-m8",
      },
      {
        id: "egress-rules",
        label: "Egress rules",
        layer: 2,
        messageId: "qi-m10",
      },
      {
        id: "issue-comments",
        label: "Issue comments",
        layer: 2,
        messageId: "qi-m12",
      },
      {
        id: "profile-settings",
        label: "Profile settings",
        layer: 2,
        messageId: "qi-m14",
      },
      {
        id: "model-credential",
        label: "Model credential",
        layer: 2,
        messageId: "qi-m16",
      },
      {
        id: "work-backup",
        label: "Work backup",
        layer: 2,
        messageId: "qi-m18",
      },
    ],
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
  {
    id: "llm-wiki",
    name: "LLM Wiki",
    category: "Knowledge",
    icon: Book,
    tagline:
      "Structured pages with a knowledge graph. The agent writes and maintains them.",
    description:
      "An agent-maintained wiki that organizes knowledge into structured pages with a knowledge graph. The agent writes new pages, updates existing ones, and maintains the links between them.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description:
          "Writes, updates, and links wiki pages from conversations and sources",
        templateId: "claude-code",
      },
    ],
    required: [],
    agentChecklist: [
      { id: "name-wiki", label: "Name the wiki", layer: 2, messageId: "lw-m1" },
      {
        id: "what-knowledge",
        label: "What knowledge it will hold",
        layer: 2,
        messageId: "lw-m3",
      },
      {
        id: "first-docs",
        label: "Hand over the first documents",
        layer: 2,
        messageId: "lw-m5",
      },
      {
        id: "git-remote",
        label: "Git remote or local-only",
        layer: 2,
        messageId: "lw-m7",
      },
      {
        id: "maintenance",
        label: "Maintenance cadence",
        layer: 2,
        messageId: "lw-m9",
      },
    ],
  },
  {
    id: "plain-wiki",
    name: "Plain Wiki",
    category: "Knowledge",
    icon: Notebook,
    tagline:
      "Simple markdown wiki. The agent writes pages and keeps them current.",
    description:
      "A lightweight markdown wiki maintained by an agent. Pages are plain files — no knowledge graph, no structured schema. The agent writes and updates them from conversations.",
    included: [
      {
        kind: "harness",
        label: "Claude Code",
        description: "Writes and updates plain markdown wiki pages",
        templateId: "claude-code",
      },
    ],
    required: [],
    agentChecklist: [
      {
        id: "what-for",
        label: "What this knowledge base is for",
        layer: 2,
        messageId: "pw-m1",
      },
      {
        id: "first-files",
        label: "First files or notes to remember",
        layer: 2,
        messageId: "pw-m3",
      },
      {
        id: "publish",
        label: "Publish for your team?",
        layer: 2,
        messageId: "pw-m5",
      },
    ],
  },
  {
    id: "nous",
    name: "Nous",
    category: "Research",
    icon: Idea,
    tagline:
      "Runs an experiment campaign: forms a hypothesis, patches your code, measures the result, keeps what worked.",
    description:
      "Runs an experiment campaign: forms a hypothesis, patches your code, measures the result, keeps what worked. Findings build up across runs. Stands in for every research kit (OpenEvolve, ShinkaEvolve, GEPA, AdaEvolve, EvoX).",
    included: [
      {
        kind: "framework",
        label: "Claude Code",
        templateId: "claude-code",
      },
      {
        kind: "connection",
        label: "GitHub",
        description: "Optional: version control for experiments",
        templateId: "github",
        connectionTemplateId: "github",
      },
    ],
    required: [],
    onboarding: false,
  },
  {
    id: "k-search",
    name: "K-Search",
    category: "Research",
    icon: MachineLearning,
    tagline: "LLM-driven GPU kernel optimization.",
    description:
      "Searches for high-performance GPU kernels using LLM-guided optimization. Requires Modal for cloud GPU access.",
    included: [
      {
        kind: "framework",
        label: "K-Search",
        templateId: "k-search",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "Modal",
        description: "Cloud GPUs for kernel evaluation",
        templateId: "modal",
        connectionTemplateId: "modal",
      },
    ],
    onboarding: false,
  },
];
