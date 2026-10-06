import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import { EntryPointButtons } from "../../../modules/agents/components/entry-point-buttons.js";
import { resetState } from "./story-helpers";

/** The home page's "Create agent" / "Browse starter kits" pair. Browsing opens
 *  the real starter-kit modal against the fixture catalog. */
const meta = {
  title: "Components/Agents/EntryPointButtons",
  component: EntryPointButtons,
  parameters: { layout: "centered" },
  loaders: [() => (resetState(), {})],
  decorators: [
    (Story) => (
      <div className="flex gap-2">
        <Story />
      </div>
    ),
  ],
  args: { surface: "home" },
} satisfies Meta<typeof EntryPointButtons>;

export default meta;
type Story = StoryObj<typeof meta>;

export const KitsFirst: Story = {};
export const AgentFirst: Story = { args: { primary: "agent" } };

/** The welcome card's single button. */
export const Welcome: Story = { args: { surface: "welcome" } };

export const BrowsingKits: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(
      within(canvasElement).getByRole("button", {
        name: "Browse starter kits",
      }),
    );
  },
};
