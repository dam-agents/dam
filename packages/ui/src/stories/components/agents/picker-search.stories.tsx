import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { PickerSearch } from "../../../modules/agents/components/bind/picker-search.js";

const meta = {
  title: "Components/Agents/PickerSearch",
  component: PickerSearch,
  parameters: { layout: "padded" },
  args: { value: "", onChange: fn() },
  render: function Render(args) {
    const [value, setValue] = useState(args.value);
    return (
      <div className="max-w-[788px]">
        <PickerSearch
          value={value}
          onChange={(v) => {
            setValue(v);
            args.onChange(v);
          }}
        />
      </div>
    );
  },
} satisfies Meta<typeof PickerSearch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const WithQuery: Story = { args: { value: "triage" } };
