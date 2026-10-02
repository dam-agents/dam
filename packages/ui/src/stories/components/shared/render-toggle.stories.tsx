import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { RenderToggle } from "@/components/render-toggle";

const meta = {
  title: "Components/Shared/RenderToggle",
  component: RenderToggle,
  parameters: { layout: "centered" },
  args: { rendered: true, onToggle: () => {} },
} satisfies Meta<typeof RenderToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Showing the rendered preview; the button switches to source. */
export const Rendered: Story = {};
/** Showing source; the button switches to the preview. */
export const Source: Story = { args: { rendered: false } };

export const Interactive: Story = {
  render: function Render() {
    const [rendered, setRendered] = useState(true);
    return (
      <RenderToggle
        rendered={rendered}
        onToggle={() => setRendered((v) => !v)}
      />
    );
  },
};
