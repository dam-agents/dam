import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PickerSectionList } from "../../../modules/agents/components/bind/picker-section-list.js";
import { pickerSections } from "../../../modules/agents/components/bind/picker-sections.js";
import { AGENTS } from "../../backend/fixtures/agents";
import { IDS } from "../../backend/scenario";
import { seedAgents } from "./story-helpers";

/** The fixture agents grouped by the real `pickerSections` ("Most recent",
 *  then A – Z). */
const meta = {
  title: "Components/Agents/PickerSectionList",
  component: PickerSectionList,
  parameters: { layout: "padded" },
  loaders: [seedAgents()],
  decorators: [
    (Story) => (
      <div className="max-w-[788px]">
        <Story />
      </div>
    ),
  ],
  args: {
    sections: pickerSections(AGENTS, ""),
    selectedId: null,
    scheduleCounts: new Map([[IDS.kbAgent, 2]]),
    onSelect: fn(),
  },
} satisfies Meta<typeof PickerSectionList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithSelection: Story = { args: { selectedId: IDS.slackAgent } };
export const Filtered: Story = {
  args: { sections: pickerSections(AGENTS, "platform") },
};
