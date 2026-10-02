import type { Meta, StoryObj } from "@storybook/react-vite";

import { UnsupportedContributionsBadge } from "../../../modules/agents/components/unsupported-contributions-badge.js";
import { codingAgent } from "./story-helpers";

/** Hover for the explanation. Renders nothing when every grant is supported. */
const meta = {
  title: "Components/Agents/UnsupportedContributionsBadge",
  component: UnsupportedContributionsBadge,
  parameters: { layout: "centered" },
  args: {
    agent: codingAgent({ unsupportedContributionKinds: ["skill", "mcp-server"] }),
  },
} satisfies Meta<typeof UnsupportedContributionsBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoUpdateAvailable: Story = {};

export const UpdateAvailable: Story = {
  args: {
    agent: codingAgent({
      unsupportedContributionKinds: ["skill"],
      templateUpdate: {
        fromImage: codingAgent().image.replace(":latest", ":1.4.2"),
        toImage: codingAgent().image.replace(":latest", ":1.5.0"),
      },
    }),
  },
};
