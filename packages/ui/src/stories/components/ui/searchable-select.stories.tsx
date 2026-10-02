import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { SearchableSelect } from "@/components/ui/searchable-select";
import { TIMEZONE_OPTIONS } from "@/modules/schedules/lib/schedule-form-options";

const openList = ({ canvasElement }: { canvasElement: HTMLElement }) => {
  canvasElement.querySelector("button")?.click();
};

const meta = {
  title: "Components/UI/SearchableSelect",
  component: SearchableSelect,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-md pb-80">
        <Story />
      </div>
    ),
  ],
  args: {
    value: "Europe/Berlin",
    onChange: fn(),
    options: TIMEZONE_OPTIONS,
    placeholder: "Select a timezone",
    invalid: false,
  },
  argTypes: {
    options: { control: false },
    invalid: { control: "boolean" },
    value: { control: "text" },
  },
} satisfies Meta<typeof SearchableSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Selected: Story = {};

export const Placeholder: Story = { args: { value: "" } };

export const Invalid: Story = { args: { value: "", invalid: true } };

export const Open: Story = { play: openList };

export const Interactive: Story = {
  render: function Interactive(args) {
    const [value, setValue] = useState("");
    return <SearchableSelect {...args} value={value} onChange={setValue} />;
  },
};
