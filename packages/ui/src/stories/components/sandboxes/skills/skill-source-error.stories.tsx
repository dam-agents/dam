import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Card } from "@/components/ui/card";
import { SourceError } from "@/modules/sandboxes/components/skills/skill-source-error";

// Copy matches the api-server's scan-failure verdicts.
const meta = {
  title: "Components/Sandboxes/Skills/SourceError",
  component: SourceError,
  parameters: { layout: "padded" },
  args: {
    failure: {
      code: "needs_github_connection",
      title: "Can't load skills from this source",
      detail:
        "The repository may be private or the URL may not be valid. Add a GitHub connection or check the URL, then re-scan.",
    },
    onManageConnections: fn(),
  },
  decorators: [
    (Story) => (
      <Card className="max-w-2xl">
        <Story />
      </Card>
    ),
  ],
} satisfies Meta<typeof SourceError>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A connection failure offers "Manage connections". */
export const NeedsGithubConnection: Story = {};
export const RepoUnreachable: Story = {
  args: {
    failure: {
      code: "repo_unreachable",
      title: "Can't load skills from this source",
      detail:
        "Your GitHub connection may not have access to this repository, or the URL may not be valid. Grant your GitHub connection access to it or check the URL, then re-scan.",
    },
  },
};
/** Not a connection failure, so no "Manage connections" link. */
export const SourcePathNotFound: Story = {
  args: {
    failure: {
      code: "source_path_not_found",
      title: "This source's path isn't in the repository",
      detail:
        "Remove the source and add it again with the correct path, or with none.",
    },
  },
};
export const AgentUnreachable: Story = {
  args: {
    failure: {
      code: "agent_unreachable",
      title: "Couldn't reach this sandbox",
      detail:
        "The sandbox couldn't be reached to scan this source. Try re-scanning in a moment.",
    },
  },
};
