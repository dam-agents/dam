import type { Meta, StoryObj } from "@storybook/react-vite";

import { RuntimeOutdatedNotice } from "../../../modules/agents/components/runtime-outdated-notice.js";
import { IDS } from "../../backend/scenario";
import { codingAgent, seedAgents } from "./story-helpers";

/** The strip above the chat when the agent's runtime can't stream live
 *  updates. It reads the agent from the agent list by id. */
const meta = {
  title: "Components/Agents/RuntimeOutdatedNotice",
  component: RuntimeOutdatedNotice,
  parameters: { layout: "fullscreen" },
  args: { agentId: IDS.codingAgent },
} satisfies Meta<typeof RuntimeOutdatedNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NoUpdateYet: Story = {
  loaders: [seedAgents([codingAgent({ features: { liveUpdates: false } })])],
};

export const UpdateAvailable: Story = {
  loaders: [
    seedAgents([
      codingAgent({
        features: { liveUpdates: false },
        templateUpdate: {
          fromImage: codingAgent().image,
          toImage: codingAgent().image.replace(":latest", ":1.5.0"),
        },
      }),
    ]),
  ],
};
