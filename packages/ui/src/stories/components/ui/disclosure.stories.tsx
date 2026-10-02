import { Folder } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import {
  DisclosureChevron,
  DisclosureToggle,
} from "@/components/ui/disclosure";
import { labelVariants } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const meta = {
  title: "Components/UI/Disclosure",
  component: DisclosureToggle,
  parameters: { layout: "padded" },
  args: {
    open: false,
    onToggle: fn(),
    chevronSize: 16,
    className:
      "gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground",
    children: "Advanced — model & tenant scoping",
  },
  argTypes: {
    open: { control: "boolean" },
    chevronSize: { control: { type: "number", min: 8, max: 24 } },
  },
} satisfies Meta<typeof DisclosureToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};

export const Expanded: Story = { args: { open: true } };

export const Interactive: Story = {
  render: function Interactive(args) {
    const [open, setOpen] = useState(false);
    return (
      <div className="max-w-md">
        <DisclosureToggle
          {...args}
          open={open}
          onToggle={() => setOpen((o) => !o)}
          chevronSize={12}
          className={cn(labelVariants(), "gap-1.5 hover:text-foreground")}
        >
          Private registry
        </DisclosureToggle>
        {open && (
          <p className="mt-3 text-sm text-muted-foreground">
            Credentials to pull this image from a private registry. Stored with
            the sandbox and used only by the cluster to pull the image — never
            exposed to the agent.
          </p>
        )}
      </div>
    );
  },
};

export const FolderHeader: Story = {
  args: {
    open: true,
    chevronClassName: "text-muted-foreground",
    className: "w-80 cursor-pointer gap-2.5 py-2.5 pl-3.5 rounded-lg border",
    children: (
      <>
        <Folder size={16} className="shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-medium">Research notes</span>
      </>
    ),
  },
};

export const Chevron: StoryObj<typeof DisclosureChevron> = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <DisclosureChevron {...args} open={false} />
      <DisclosureChevron {...args} open />
    </div>
  ),
  args: { size: 16 },
};
