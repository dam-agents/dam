import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { SessionListSkeleton } from "../../../modules/sessions/components/session-list-skeleton.js";
import { SidebarSection } from "../../../modules/sessions/components/sidebar-section.js";

/** A collapsible section of the chat sidebar (Sessions, Files, Artifacts). */
const meta = {
  title: "Components/Sessions/SidebarSection",
  component: SidebarSection,
  args: {
    title: "Artifacts",
    open: true,
    onToggle: () => {},
    headerClassName: "border-t border-border",
    children: <SessionListSkeleton rows={2} />,
  },
  render: function Render(args) {
    const [open, setOpen] = useState(args.open);
    return (
      <div className="flex h-[400px] w-[280px] flex-col border-r border-border">
        <SidebarSection
          {...args}
          open={open}
          onToggle={() => setOpen((o) => !o)}
        />
      </div>
    );
  },
} satisfies Meta<typeof SidebarSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const Collapsed: Story = { args: { open: false } };
