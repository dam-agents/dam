import type { CarbonIconType } from "@carbon/icons-react";
import {
  Bot,
  Chat,
  Chemistry,
  Code,
  Document,
  Idea,
  Plug,
  Time,
  Wikis,
} from "@carbon/icons-react";

/**
 * A pack is a preset. Applying it copies its configuration onto a generic agent
 * and the relationship ends there — no versioning, no update prompts, no revert.
 * Applying is additive: it never overwrites what the user already configured.
 */

/** Every primitive a pack can carry. Kept in step with what DAM actually has. */
export type PackIngredientKind =
  | "harness"
  | "framework"
  | "connection"
  | "channel"
  | "schedule"
  | "skill"
  | "knowledge-base"
  | "starter-repo"
  | "artifact";

export const INGREDIENT_ICON: Record<PackIngredientKind, CarbonIconType> = {
  harness: Bot,
  framework: Chemistry,
  connection: Plug,
  channel: Chat,
  schedule: Time,
  skill: Idea,
  "knowledge-base": Wikis,
  "starter-repo": Code,
  artifact: Document,
};

/** Singular and plural label per kind, for the counts on a card. */
export const INGREDIENT_LABEL: Record<
  PackIngredientKind,
  { one: string; many: string }
> = {
  harness: { one: "harness", many: "harnesses" },
  framework: { one: "framework", many: "frameworks" },
  connection: { one: "connection", many: "connections" },
  channel: { one: "channel", many: "channels" },
  schedule: { one: "schedule", many: "schedules" },
  skill: { one: "skill", many: "skills" },
  "knowledge-base": { one: "knowledge base", many: "knowledge bases" },
  "starter-repo": { one: "starter repo", many: "starter repos" },
  artifact: { one: "artifact", many: "artifacts" },
};

/** What the pack sets up. The user does nothing. */
export interface PackIngredient {
  kind: PackIngredientKind;
  name: string;
  detail: string;
}

/**
 * What the user supplies. One slot list, three surfaces: the detail page lists
 * them under "You'll need", the demo fills each with `demoValue`, and applying
 * turns the unfilled ones into the fill-these-in list. Applying is never
 * blocked on an unfilled slot.
 */
export interface PackSlot {
  kind: PackIngredientKind;
  /** What the user has to point at, e.g. "A GitHub repo". */
  label: string;
  /** Stand-in the demo runs on. Reads as sample data on purpose. */
  demoValue: string;
  /**
   * Connection templates that fill this slot. Present on connection slots only,
   * so the detail page can tell the user whether they already have one.
   */
  templateIds?: string[];
}

/** Every real GitHub connection template satisfies a GitHub slot. */
const GITHUB_TEMPLATE_IDS = ["github", "github-pat", "github-enterprise"];

export type PackFacet = "Development" | "Knowledge" | "Monitoring" | "Research";

export interface Pack {
  id: string;
  name: string;
  facet: PackFacet;
  icon: CarbonIconType;
  /** One line on the card. */
  tagline: string;
  /** What the user has after a week of it running. */
  outcome: string;
  included: PackIngredient[];
  slots: PackSlot[];
  /** From the agent template, when the pack is built on one. */
  docsUrl?: string;
  setupNote?: { title: string; body: string };
}

export const PACK_FACETS: readonly PackFacet[] = [
  "Development",
  "Knowledge",
  "Monitoring",
  "Research",
];

export const PACKS: Pack[] = [
  {
    id: "design-prototyper",
    name: "Design prototyper",
    facet: "Development",
    icon: Idea,
    tagline: "Turns a design ticket into a prototype you can click through",
    outcome:
      "Every ticket you point it at comes back as a prototype on its own branch, ready to hand to a developer.",
    included: [
      {
        kind: "harness",
        name: "Claude Code",
        detail: "Reads and writes code in the agent's workspace",
      },
      {
        kind: "skill",
        name: "Prototyper",
        detail: "Builds a prototype from a ticket and the design system",
      },
      {
        kind: "artifact",
        name: "Prototype link",
        detail: "A shareable page per prototype",
      },
    ],
    slots: [
      {
        kind: "connection",
        label: "A GitHub connection",
        templateIds: GITHUB_TEMPLATE_IDS,
        demoValue: "sample-org/sample-design-repo",
      },
      {
        kind: "knowledge-base",
        label: "A knowledge base for project context",
        demoValue: "Sample design system notes",
      },
      {
        kind: "channel",
        label: "A Slack channel to work in",
        demoValue: "#sample-design",
      },
    ],
  },
  {
    id: "code-reviewer",
    name: "Code reviewer",
    facet: "Development",
    icon: Code,
    tagline: "Reviews open pull requests every morning and posts what it found",
    outcome:
      "A daily review of every open pull request in your channel, so nothing sits unread for a week.",
    included: [
      {
        kind: "harness",
        name: "Claude Code",
        detail: "Reads diffs in the agent's workspace",
      },
      {
        kind: "skill",
        name: "Code review",
        detail: "Reviews a diff against the repo's own conventions",
      },
      {
        kind: "schedule",
        name: "Weekday mornings",
        detail: "Sweeps open pull requests unattended",
      },
    ],
    slots: [
      {
        kind: "connection",
        label: "A GitHub connection",
        templateIds: GITHUB_TEMPLATE_IDS,
        demoValue: "sample-org/sample-service",
      },
      {
        kind: "channel",
        label: "A Slack channel for the review",
        demoValue: "#sample-reviews",
      },
    ],
  },
  {
    id: "codebase-qa",
    name: "Codebase Q&A",
    facet: "Knowledge",
    icon: Wikis,
    tagline:
      "Answers questions about a repo in the channel your team already uses",
    outcome:
      "Your team asks where something lives in Slack and gets an answer with the file, instead of waiting for whoever wrote it.",
    included: [
      {
        kind: "harness",
        name: "Claude Code",
        detail: "Reads the repo in the agent's workspace",
      },
      {
        kind: "knowledge-base",
        name: "Plain wiki",
        detail: "Pages the agent writes and answers from",
      },
      {
        kind: "schedule",
        name: "Nightly",
        detail: "Re-reads the repo so answers keep up with it",
      },
    ],
    slots: [
      {
        kind: "connection",
        label: "A GitHub connection",
        templateIds: GITHUB_TEMPLATE_IDS,
        demoValue: "sample-org/sample-monorepo",
      },
      {
        kind: "channel",
        label: "A Slack channel for questions",
        demoValue: "#sample-engineering",
      },
    ],
  },
  {
    id: "link-monitor",
    name: "Broken link monitor",
    facet: "Monitoring",
    icon: Time,
    tagline: "Checks your links daily and reports what broke",
    outcome:
      "A daily report of every link that stopped working, so a dead URL is caught before someone clicks it.",
    included: [
      {
        kind: "harness",
        name: "Claude Code",
        detail: "Runs the checks in the agent's workspace",
      },
      {
        kind: "starter-repo",
        name: "Link Guardian",
        detail: "Seeded into the workspace when the agent is created",
      },
      {
        kind: "schedule",
        name: "Daily",
        detail: "Runs the check unattended",
      },
      {
        kind: "artifact",
        name: "Daily report",
        detail: "One page per run",
      },
    ],
    slots: [
      {
        kind: "channel",
        label: "A Slack channel for the report",
        demoValue: "#sample-web",
      },
    ],
  },
  {
    id: "paper-scanner",
    name: "Research paper scanner",
    facet: "Research",
    icon: Document,
    tagline: "Scans arXiv for work related to your repo and writes it up",
    outcome:
      "A weekly page of papers relevant to what you are building, with why each one matters to your repo.",
    included: [
      {
        kind: "harness",
        name: "Claude Code",
        detail: "Runs the scan in the agent's workspace",
      },
      {
        kind: "starter-repo",
        name: "arXiv Scanner",
        detail: "Seeded into the workspace when the agent is created",
      },
      {
        kind: "schedule",
        name: "Weekly",
        detail: "Runs the scan unattended",
      },
      {
        kind: "artifact",
        name: "Weekly digest",
        detail: "One page per scan",
      },
    ],
    slots: [
      {
        kind: "connection",
        label: "A GitHub connection",
        templateIds: GITHUB_TEMPLATE_IDS,
        demoValue: "sample-org/sample-research-repo",
      },
      {
        kind: "channel",
        label: "A Slack channel for the digest",
        demoValue: "#sample-research",
      },
    ],
  },
  {
    id: "optimization-campaign",
    name: "Optimization campaign",
    facet: "Research",
    icon: Chemistry,
    tagline: "Runs NOUS against your code to find a faster version",
    outcome:
      "A record of what NOUS tried, what it measured, and the best version it found.",
    included: [
      {
        kind: "framework",
        name: "NOUS",
        detail: "Hypothesis-driven experimentation, in place of a harness",
      },
      {
        kind: "artifact",
        name: "Campaign record",
        detail: "What each run tried and measured",
      },
    ],
    slots: [
      {
        kind: "connection",
        label: "A GitHub connection for the code to optimize",
        templateIds: GITHUB_TEMPLATE_IDS,
        demoValue: "sample-org/sample-kernels",
      },
      {
        kind: "connection",
        label: "A Modal connection for GPUs to evaluate on",
        templateIds: ["modal"],
        demoValue: "Sample Modal workspace",
      },
    ],
    docsUrl:
      "https://github.com/dam-agents/dam/blob/main/packages/agents/nous/README.md",
    setupNote: {
      title: "A campaign runs for a long time",
      body: "One run takes 30 to 60 minutes and keeps the agent awake throughout.",
    },
  },
];

/** Counts every kind a pack carries, in a stable order, zeros omitted. */
export function ingredientCounts(
  pack: Pack,
): { kind: PackIngredientKind; count: number; label: string }[] {
  const order: PackIngredientKind[] = [
    "harness",
    "framework",
    "connection",
    "channel",
    "schedule",
    "skill",
    "knowledge-base",
    "starter-repo",
    "artifact",
  ];
  const tally = new Map<PackIngredientKind, number>();
  for (const item of [...pack.included, ...pack.slots]) {
    tally.set(item.kind, (tally.get(item.kind) ?? 0) + 1);
  }
  return order
    .map((kind) => ({ kind, count: tally.get(kind) ?? 0 }))
    .filter(({ count }) => count > 0)
    .map(({ kind, count }) => ({
      kind,
      count,
      label:
        count === 1 ? INGREDIENT_LABEL[kind].one : INGREDIENT_LABEL[kind].many,
    }));
}
