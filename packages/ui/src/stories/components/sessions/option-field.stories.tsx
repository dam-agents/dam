import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  OptionField,
  ReadOnlyOptionFace,
} from "../../../modules/sessions/components/option-field.js";

/** A labelled model-settings field. Shown with the read-only face Agent Setup
 *  uses for a stopped agent whose settings were never recorded. */
const meta = {
  title: "Components/Sessions/OptionField",
  component: OptionField,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[600px]">
        <Story />
      </div>
    ),
  ],
  args: {
    title: "Model",
    children: <ReadOnlyOptionFace label="Unknown" hint="Start agent to view" />,
  },
} satisfies Meta<typeof OptionField>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UnknownValue: Story = {};
