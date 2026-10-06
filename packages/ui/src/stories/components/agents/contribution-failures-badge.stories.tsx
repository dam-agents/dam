import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  agentFailures,
  ContributionFailuresBadge,
} from "../../../modules/agents/components/contribution-failures-badge.js";
import { codingAgent } from "./story-helpers";

/** Hover the badge for the per-install detail. Renders nothing with no failures. */
const meta = {
  title: "Components/Agents/ContributionFailuresBadge",
  component: ContributionFailuresBadge,
  parameters: { layout: "centered" },
  args: {
    failures: [
      { kind: "skill", message: "code-review: SKILL.md missing frontmatter" },
    ],
  },
} satisfies Meta<typeof ContributionFailuresBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneFailure: Story = {};

/** Settled workspace failures are folded in by `agentFailures`. */
export const SeveralFailures: Story = {
  args: {
    failures: agentFailures(
      codingAgent({
        contributionFailures: [
          {
            kind: "skill",
            message: "code-review: SKILL.md missing frontmatter",
          },
          { kind: "mcp-server", message: "github: npx exited with code 1" },
        ],
        workspaceFailures: [
          {
            kind: "workspace-seed",
            error: "git clone: repository not found",
            settled: true,
            attempts: 3,
            maxAttempts: 3,
          },
        ],
      }),
    ),
  },
};

export const NoFailures: Story = { args: { failures: [] } };
