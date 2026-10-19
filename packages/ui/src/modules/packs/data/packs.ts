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
  Search,
  Security,
  Settings,
  TaskComplete,
  UserMultiple,
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
    tagline: "Every pull request gets a review, within minutes.",
    description:
      "Watches your repositories for open pull requests, runs automated code review, nudges reviewers who go quiet, and keeps your review queue moving so nothing goes stale.",
    included: [
      {
        kind: "connection",
        label: "Slack",
        description: "Optional: review notifications and reviewer nudges",
        templateId: "slack",
        connectionTemplateId: "slack",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description:
          "GitHub or GitHub Enterprise — read PRs, diffs, and reviewer activity",
        templateId: "github",
        connectionTemplateId: "github",
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
        id: "weekly-survey",
        label: "Codebase survey",
        description: "Scans the codebase for drift and style violations",
        cron: "Mon 6:00",
        defaultOn: false,
      },
      {
        id: "monthly-bench",
        label: "Monthly benchmark",
        description: "Review quality metrics across the month",
        defaultOn: false,
      },
      {
        id: "health-check",
        label: "Health check",
        description: "Verifies the reviewer is reachable and configs are valid",
        cron: "Every 15 min",
        defaultOn: true,
      },
    ],
    agentChecklist: [
      { id: "backup-repo", label: "Backup repository", layer: 2 },
      { id: "repo-to-review", label: "Repository to review", layer: 2 },
      { id: "review-name", label: "Name to sign reviews with", layer: 2 },
      { id: "labels", label: "Labels", layer: 2 },
      { id: "slack-notifications", label: "Slack notifications", layer: 2 },
      { id: "review-hours", label: "Review hours", layer: 2 },
    ],
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
  {
    id: "software-developer",
    name: "Software Developer",
    category: "Development",
    icon: Code,
    tagline:
      "Picks up issues, writes code, opens PRs, and iterates on review feedback.",
    description:
      "An autonomous developer that reads GitHub issues, writes implementation code, opens pull requests, and responds to review feedback. Works through your backlog while you focus on design and direction.",
    included: [],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description:
          "GitHub or GitHub Enterprise — read issues, push branches, open PRs",
        templateId: "github",
        connectionTemplateId: "github",
      },
    ],
    agentChecklist: [
      { id: "backup", label: "Where work is backed up", layer: 2 },
      { id: "target-repo", label: "Which repository to work on", layer: 2 },
      {
        id: "watch-mode",
        label: "Watch GitHub or only work when asked",
        layer: 2,
      },
      { id: "labels", label: "Labels", layer: 2 },
      {
        id: "build-check-test",
        label: "How to build, check and test",
        layer: 2,
      },
      {
        id: "push-confirm",
        label: "Confirm the account can push and open pull requests",
        layer: 2,
      },
      { id: "platform-address", label: "Platform address", layer: 2 },
      { id: "schedules", label: "Schedules", layer: 2 },
      { id: "slack-updates", label: "Slack updates", layer: 2 },
      { id: "never-touch", label: "What never to touch", layer: 2 },
    ],
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
  {
    id: "quality-assurance",
    name: "Quality Assurance",
    category: "Software",
    icon: TaskComplete,
    tagline: "Writes and runs end-to-end tests for every feature branch.",
    description:
      "Monitors feature branches, generates end-to-end test suites, runs them against staging, and reports results on the PR. Catches regressions before they reach main.",
    included: [
      {
        kind: "connection",
        label: "Slack",
        description: "Optional: test result notifications",
        templateId: "slack",
        connectionTemplateId: "slack",
      },
    ],
    required: [
      {
        kind: "connection",
        label: "GitHub",
        description:
          "GitHub or GitHub Enterprise — read branches, post test results",
        templateId: "github",
        connectionTemplateId: "github",
      },
    ],
    agentChecklist: [
      {
        id: "source-repo",
        label: "Which repository the platform is built from",
        layer: 2,
      },
      {
        id: "read-confirm",
        label: "Confirm the account can read it",
        layer: 2,
      },
      {
        id: "model-connection",
        label: "Model connection for the platform under test",
        layer: 2,
      },
      { id: "slack-requests", label: "Slack requests", layer: 2 },
      { id: "never-touch", label: "What never to touch", layer: 2 },
      { id: "first-install", label: "First install", layer: 2 },
    ],
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
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
        kind: "connection",
        label: "Slack",
        description: "Optional: test result notifications",
        templateId: "slack",
        connectionTemplateId: "slack",
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
      { id: "product-profile", label: "Product profile", layer: 1 },
      { id: "backend", label: "Backend", layer: 2 },
      { id: "target-repo", label: "Target repository", layer: 2 },
      { id: "egress-rules", label: "Egress rules", layer: 1 },
      { id: "issue-comments", label: "Issue comments", layer: 2 },
      { id: "profile-settings", label: "Profile settings", layer: 2 },
      { id: "model-credential", label: "Model credential", layer: 2 },
      { id: "work-backup", label: "Work backup", layer: 2 },
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
        kind: "connection",
        label: "GitHub",
        description: "Optional: lets the assistant update itself and back up",
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
      { id: "who-i-am", label: "Who I am", layer: 2 },
      { id: "what-i-do", label: "What I take care of", layer: 2 },
      { id: "how-we-work", label: "How we work together", layer: 2 },
      { id: "slack-member-id", label: "Your Slack member ID", layer: 2 },
    ],
  },
  {
    id: "micro-manager",
    name: "Micro-Manager",
    category: "Productivity",
    icon: UserMultiple,
    tagline: "Never lose track of what you asked someone to do in Slack.",
    description:
      "Reads your Slack conversations, tracks delegated tasks, follows up when things go quiet, and gives you a daily status of who owes what. Connected as you, not a bot.",
    included: [],
    required: [
      {
        kind: "connection",
        label: "Slack",
        description: "Connected as you (not a bot) — reads your conversations",
        templateId: "slack",
        connectionTemplateId: "slack",
      },
    ],
    agentChecklist: [
      { id: "confirm-slack", label: "Confirm your Slack account", layer: 2 },
      { id: "channels", label: "Which channels to read", layer: 2 },
      { id: "hand-work-to", label: "Who you hand work to", layer: 2 },
      { id: "bots", label: "Which bots you talk to", layer: 2 },
      { id: "dry-run", label: "Approve the dry run", layer: 2 },
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
    included: [],
    required: [],
    agentChecklist: [
      { id: "name-wiki", label: "Name the wiki", layer: 2 },
      {
        id: "what-knowledge",
        label: "Say what knowledge it will hold",
        layer: 2,
      },
      { id: "first-docs", label: "Hand over the first documents", layer: 2 },
      {
        id: "git-remote",
        label: "Decide whether the wiki gets a git remote",
        layer: 2,
      },
      { id: "maintenance", label: "Decide on a maintenance cadence", layer: 2 },
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
    included: [],
    required: [],
    agentChecklist: [
      {
        id: "what-for",
        label: "Tell me what this knowledge base is for",
        layer: 2,
      },
      {
        id: "first-files",
        label: "Give me the first files or notes to remember",
        layer: 2,
      },
      {
        id: "publish",
        label: "Decide whether to publish it for your team",
        layer: 2,
      },
    ],
  },
  {
    id: "spotlights",
    name: "Spotlights",
    category: "Research",
    icon: Search,
    tagline:
      "Deep-dives into your codebase and surfaces insights you'd miss in a review.",
    description:
      "Runs targeted research campaigns across your repositories — architecture analysis, dependency audits, dead-code detection, and pattern extraction. Publishes findings as structured reports.",
    included: [
      {
        kind: "connection",
        label: "GitHub",
        description: "Optional: read repository contents directly",
        templateId: "github",
        connectionTemplateId: "github",
      },
    ],
    required: [],
    agentChecklist: [
      { id: "target-repo", label: "Target repository", layer: 2 },
      { id: "optimization-goal", label: "Optimization goal", layer: 2 },
      { id: "modules", label: "Modules to include", layer: 2 },
      {
        id: "approve-run",
        label: "Approve the first run (about $15–20 and 20–45 min per module)",
        layer: 2,
      },
    ],
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
  {
    id: "k-search",
    name: "K-Search",
    category: "Research",
    icon: MachineLearning,
    tagline: "LLM-driven GPU kernel optimization.",
    description:
      "Searches for high-performance GPU kernels using LLM-guided optimization. Requires Modal for cloud GPU access.",
    included: [],
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
  {
    id: "nous",
    name: "Nous",
    category: "Research",
    icon: Idea,
    tagline:
      "Runs an experiment campaign: forms a hypothesis, patches your code, measures the result, keeps what worked.",
    description:
      "Runs an experiment campaign: forms a hypothesis, patches your code, measures the result, keeps what worked. Findings build up across runs.",
    included: [
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
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
  {
    id: "openevolve",
    name: "OpenEvolve",
    category: "Research",
    icon: Debug,
    tagline:
      "Open-ended evolutionary optimization — evolves code solutions across generations.",
    description:
      "Uses LLM-guided mutations to evolve code solutions over multiple generations. Runs fitness evaluations, keeps the best variants, and builds on them. Connects to your repo for version control.",
    included: [
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
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
  {
    id: "shinkaevolve",
    name: "ShinkaEvolve",
    category: "Research",
    icon: Settings,
    tagline:
      "Progressive evolution — refines code through incremental, guided mutations.",
    description:
      "Applies progressive, incremental mutations to improve code. Each generation builds carefully on the last, with guided selection that favors stability alongside performance gains.",
    included: [
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
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
  {
    id: "gepa",
    name: "GEPA",
    category: "Research",
    icon: Document,
    tagline: "Genetic programming with LLM-guided crossover and mutation.",
    description:
      "Runs genetic programming experiments using LLM-guided crossover and mutation operators. Maintains a population of candidate solutions and evolves them toward a fitness target.",
    included: [
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
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
  {
    id: "adaevolve",
    name: "AdaEvolve",
    category: "Research",
    icon: FlashFilled,
    tagline:
      "Adaptive evolution — mutates and benchmarks code to find better solutions.",
    description:
      "Uses LLM-guided adaptive evolution to improve code performance. Connects to your repo, mutates targeted functions, benchmarks the results, and keeps the winners.",
    included: [
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
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
  {
    id: "evox",
    name: "EvoX",
    category: "Research",
    icon: Box,
    tagline:
      "Cross-pollination evolution — transfers improvements across related codebases.",
    description:
      "Evolves code by cross-pollinating improvements across related repositories. Identifies patterns that worked in one codebase and applies them to another.",
    included: [
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
    sizeCpuMilli: 2000,
    sizeMemoryMi: 2048,
  },
];
