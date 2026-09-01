import type { Message } from "../../../types.js";

export interface PackDemoFixtures {
  seedMessages: Message[];
  schedules: PackDemoSchedule[];
  connections: PackDemoConnection[];
  artifacts: PackDemoArtifact[];
}

export interface PackDemoSchedule {
  id: string;
  name: string;
  rrule: string;
  timezone: string;
  enabled: boolean;
  sessionMode: string;
  status: {
    lastRun: string;
    nextRun: string;
    lastResult: string;
  };
}

export interface PackDemoConnection {
  id: string;
  templateId: string;
  name: string;
  status: string;
}

export interface PackDemoArtifact {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
}

const DEMO_FIXTURES: Record<string, PackDemoFixtures> = {
  "code-reviewer": {
    seedMessages: [
      {
        id: "demo-msg-001",
        role: "assistant",
        streaming: false,
        parts: [
          {
            kind: "text",
            text: "Scheduled nightly audit complete. I reviewed 3 open pull requests against your coding standards.\n\n**PR #142 — Add pagination to search results**\nFound 2 issues: missing error boundary around the async fetch, and a dependency on `lodash.get` that can be replaced with optional chaining.\n\n**PR #138 — Refactor auth middleware**\nLooks good. One suggestion: the token refresh logic duplicates what's already in `lib/auth-helpers` — consider reusing it.\n\n**PR #135 — Update CI pipeline**\nFlagged 1 security issue: the new step pins a GitHub Action by branch (`@main`) instead of a commit SHA. This is a supply-chain risk.\n\nDependency audit found 0 critical vulnerabilities across all lockfiles.",
          },
        ],
      },
      {
        id: "demo-msg-002",
        role: "assistant",
        streaming: false,
        parts: [
          {
            kind: "text",
            text: "I posted review comments directly on each PR. The dependency audit report is saved as an artifact if you want the full breakdown.",
          },
        ],
      },
    ],
    schedules: [
      {
        id: "demo-sched-cr-001",
        name: "Nightly audit",
        rrule: "RRULE:FREQ=DAILY;BYHOUR=2;BYMINUTE=0",
        timezone: "America/New_York",
        enabled: true,
        sessionMode: "fresh",
        status: {
          lastRun: new Date(Date.now() - 8 * 3600_000).toISOString(),
          nextRun: new Date(Date.now() + 16 * 3600_000).toISOString(),
          lastResult: "success",
        },
      },
    ],
    connections: [
      {
        id: "demo-conn-github",
        templateId: "conn-tpl-github",
        name: "GitHub",
        status: "connected",
      },
    ],
    artifacts: [
      {
        id: "demo-artifact-cr-001",
        name: "dependency-audit-report.md",
        mimeType: "text/markdown",
        sizeBytes: 4200,
      },
    ],
  },

  "design-prototyper": {
    seedMessages: [
      {
        id: "demo-msg-dp-001",
        role: "assistant",
        streaming: false,
        parts: [
          {
            kind: "text",
            text: 'Issue scan complete. Found 2 new issues tagged "design" in the repository.\n\n**Issue #87 — Settings page redesign**\nGenerated an interactive prototype with your design tokens. The layout uses your `spacing-lg` and `color-surface-secondary` tokens. Preview is saved as an artifact.\n\n**Issue #84 — Empty state illustrations**\nCreated placeholder compositions using your brand color palette. Ready for review.',
          },
        ],
      },
    ],
    schedules: [
      {
        id: "demo-sched-dp-001",
        name: "Issue scan",
        rrule: "RRULE:FREQ=MINUTELY;INTERVAL=30",
        timezone: "America/New_York",
        enabled: true,
        sessionMode: "fresh",
        status: {
          lastRun: new Date(Date.now() - 1800_000).toISOString(),
          nextRun: new Date(Date.now() + 1800_000).toISOString(),
          lastResult: "success",
        },
      },
    ],
    connections: [
      {
        id: "demo-conn-github",
        templateId: "conn-tpl-github",
        name: "GitHub",
        status: "connected",
      },
    ],
    artifacts: [
      {
        id: "demo-artifact-dp-001",
        name: "settings-prototype.html",
        mimeType: "text/html",
        sizeBytes: 12800,
      },
    ],
  },

  "optimization-campaign": {
    seedMessages: [
      {
        id: "demo-msg-oc-001",
        role: "assistant",
        streaming: false,
        parts: [
          {
            kind: "text",
            text: "Optimization campaign completed after 50 generations.\n\n**Best solution**: fitness score 0.94 (up from 0.31 at generation 0)\n**Total evaluations**: 2,400 across 50 generations\n**Compute used**: 18.3 GPU-hours on Modal\n\nThe winning solution improved the target function by 3x over the baseline. Full results and the evolved code are saved as artifacts.",
          },
        ],
      },
    ],
    schedules: [],
    connections: [],
    artifacts: [
      {
        id: "demo-artifact-oc-001",
        name: "optimization-results.json",
        mimeType: "application/json",
        sizeBytes: 89400,
      },
      {
        id: "demo-artifact-oc-002",
        name: "evolved-solution.py",
        mimeType: "text/x-python",
        sizeBytes: 3200,
      },
    ],
  },
};

export function getDemoFixtures(packId: string): PackDemoFixtures | null {
  return DEMO_FIXTURES[packId] ?? null;
}
