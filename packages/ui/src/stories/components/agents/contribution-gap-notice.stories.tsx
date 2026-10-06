import type { Meta, StoryObj } from "@storybook/react-vite";

import { ContributionGapNotice } from "../../../modules/agents/components/contribution-gap-notice.js";
import { IDS } from "../../backend/scenario";
import { codingAgent, seedAgents } from "./story-helpers";

/** The strip above the chat when the agent's runtime is too old for some of
 *  its grants. It reads the agent from the agent list by id. */
const meta = {
  title: "Components/Agents/ContributionGapNotice",
  component: ContributionGapNotice,
  parameters: { layout: "fullscreen" },
  args: { agentId: IDS.codingAgent },
} satisfies Meta<typeof ContributionGapNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoUpdateYet: Story = {
  loaders: [
    seedAgents([
      codingAgent({ unsupportedContributionKinds: ["skill", "mcp-server"] }),
    ]),
  ],
};

export const UpdateAvailable: Story = {
  loaders: [
    seedAgents([
      codingAgent({
        unsupportedContributionKinds: ["skill"],
        templateUpdate: {
          fromImage: codingAgent().image,
          toImage: codingAgent().image.replace(":latest", ":1.5.0"),
        },
      }),
    ]),
  ],
};
