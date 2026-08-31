export interface PackRequirement {
  type: "connection" | "skill" | "knowledge-base";
  name: string;
  description: string;
  required: boolean;
}

export interface Pack {
  id: string;
  name: string;
  category: "Personal" | "Team";
  accent: "blue" | "violet" | "amber" | "emerald" | "rose" | "cyan";
  icon: string;
  tagline: string;
  description: string;
  requirements: PackRequirement[];
}

export const PACKS: Pack[] = [
  {
    id: "design-prototyper",
    name: "Design Prototyper",
    category: "Personal",
    accent: "blue",
    icon: "🎨",
    tagline:
      "Reads your GitHub issues and builds interactive prototypes with your design system",
    description:
      "Reads your GitHub issues and spins up interactive prototypes with your design system. Connects Figma, reads project context, and iterates with you in real-time chat. The fastest path from idea to clickable mockup.",
    requirements: [
      {
        type: "connection",
        name: "GitHub",
        description: "Read issues, PRs, and repo files",
        required: true,
      },
      {
        type: "connection",
        name: "Figma",
        description: "Push and pull design assets",
        required: true,
      },
      {
        type: "skill",
        name: "Prototyper",
        description: "Generates interactive HTML/React prototypes",
        required: true,
      },
      {
        type: "knowledge-base",
        name: "Project context",
        description:
          "Your design system, brand guidelines, and past decisions",
        required: false,
      },
    ],
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    category: "Team",
    accent: "violet",
    icon: "🔍",
    tagline:
      "Reviews pull requests against your team's standards automatically",
    description:
      "Automatically reviews pull requests against your team's coding standards. Catches bugs, suggests improvements, and flags security vulnerabilities before they reach production.",
    requirements: [
      {
        type: "connection",
        name: "GitHub",
        description: "Read PRs, diffs, and CI status",
        required: true,
      },
      {
        type: "skill",
        name: "Code Review",
        description: "Static analysis, style checks, and security scanning",
        required: true,
      },
      {
        type: "knowledge-base",
        name: "Team standards",
        description: "Your coding conventions and review checklist",
        required: false,
      },
    ],
  },
  {
    id: "research-assistant",
    name: "Research Assistant",
    category: "Personal",
    accent: "amber",
    icon: "📚",
    tagline:
      "Deep-dives into topics with web search and structured synthesis",
    description:
      "Deep-dives into topics with web search, document analysis, and structured synthesis. Produces cited reports and maintains a running knowledge base that improves over time.",
    requirements: [
      {
        type: "connection",
        name: "Web Search",
        description: "Search the web for current information",
        required: true,
      },
      {
        type: "skill",
        name: "Analysis & Synthesis",
        description: "Structured research with citations and summaries",
        required: true,
      },
      {
        type: "knowledge-base",
        name: "Research archive",
        description: "Prior findings, sources, and accumulated context",
        required: true,
      },
    ],
  },
  {
    id: "devops-monitor",
    name: "DevOps Monitor",
    category: "Team",
    accent: "emerald",
    icon: "⚡",
    tagline:
      "Watches infrastructure, surfaces anomalies, and suggests remediation",
    description:
      "Watches your infrastructure, surfaces anomalies, and suggests remediation before they become incidents. Connects to your cloud provider and incident management tools.",
    requirements: [
      {
        type: "connection",
        name: "AWS / GCP",
        description: "Read metrics, logs, and resource state",
        required: true,
      },
      {
        type: "connection",
        name: "PagerDuty",
        description: "Create and manage incident alerts",
        required: false,
      },
      {
        type: "skill",
        name: "Monitoring",
        description:
          "Anomaly detection, log analysis, and runbook execution",
        required: true,
      },
    ],
  },
  {
    id: "content-writer",
    name: "Content Writer",
    category: "Personal",
    accent: "rose",
    icon: "✍️",
    tagline:
      "Drafts content in your brand voice and publishes to your CMS",
    description:
      "Drafts blog posts, documentation, and marketing copy in your brand voice. Learns your style guide and integrates with your CMS for direct publishing.",
    requirements: [
      {
        type: "connection",
        name: "CMS",
        description: "Publish directly to WordPress, Notion, or Contentful",
        required: true,
      },
      {
        type: "skill",
        name: "SEO & Writing",
        description:
          "Keyword research, meta tags, and readability optimization",
        required: true,
      },
      {
        type: "knowledge-base",
        name: "Brand guidelines",
        description: "Tone of voice, style guide, and approved terminology",
        required: true,
      },
    ],
  },
  {
    id: "data-analyst",
    name: "Data Analyst",
    category: "Team",
    accent: "cyan",
    icon: "📊",
    tagline:
      "Queries databases, builds visualizations, and generates reports",
    description:
      "Queries your databases, builds visualizations, and generates reports. Understands SQL, dbt models, and your data warehouse schema for accurate, context-aware analysis.",
    requirements: [
      {
        type: "connection",
        name: "Database",
        description: "Read-only access to your data warehouse",
        required: true,
      },
      {
        type: "connection",
        name: "dbt",
        description: "Understand model lineage and definitions",
        required: false,
      },
      {
        type: "skill",
        name: "Visualization",
        description: "Charts, dashboards, and formatted reports",
        required: true,
      },
    ],
  },
];

export const PACK_CATEGORIES = ["Personal", "Team"] as const;
