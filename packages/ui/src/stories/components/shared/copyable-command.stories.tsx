import type { Meta, StoryObj } from "@storybook/react-vite";

import { getBrand } from "@/brand";
import { CopyableCommand } from "@/components/copyable-command";

import { IDS } from "../../backend/scenario";

const meta = {
  title: "Components/Shared/CopyableCommand",
  component: CopyableCommand,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[480px]">
        <Story />
      </div>
    ),
  ],
  args: { command: "" },
} satisfies Meta<typeof CopyableCommand>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The attach command from the "Open in terminal" dialog. */
export const Chat: Story = {
  render: () => (
    <CopyableCommand command={`${getBrand().short} chat ${IDS.codingAgent}`} />
  ),
};

/** Long commands scroll horizontally instead of wrapping. */
export const LongCommand: Story = {
  render: () => (
    <CopyableCommand
      command={`${getBrand().short} ssh connect -x code ${IDS.codingAgent}`}
    />
  ),
};
