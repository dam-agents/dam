import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ResizeHandle } from "@/components/resize-handle";

const meta = {
  title: "Components/Shared/ResizeHandle",
  component: ResizeHandle,
  args: { onResize: () => {} },
} satisfies Meta<typeof ResizeHandle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Drag the divider between the panes (it highlights on hover). */
export const Horizontal: Story = {
  render: function Render() {
    const [width, setWidth] = useState(320);
    return (
      <div className="flex h-[360px] border border-border">
        <div className="bg-card p-4 text-sm" style={{ width }}>
          Sidebar · {width}px
        </div>
        <ResizeHandle
          side="left"
          onResize={(d) => setWidth((w) => Math.max(160, w + d))}
        />
        <div className="flex-1 border-l border-border p-4 text-sm">Main</div>
      </div>
    );
  },
};

/** `side="right"` for a panel docked on the right edge. */
export const RightPanel: Story = {
  render: function Render() {
    const [width, setWidth] = useState(320);
    return (
      <div className="flex h-[360px] border border-border">
        <div className="flex-1 border-r border-border p-4 text-sm">Main</div>
        <ResizeHandle
          side="right"
          onResize={(d) => setWidth((w) => Math.max(160, w + d))}
        />
        <div className="bg-card p-4 text-sm" style={{ width }}>
          Files · {width}px
        </div>
      </div>
    );
  },
};

export const Vertical: Story = {
  render: function Render() {
    const [height, setHeight] = useState(180);
    return (
      <div className="flex h-[420px] flex-col border border-border">
        <div className="bg-card p-4 text-sm" style={{ height }}>
          Chat · {height}px
        </div>
        <ResizeHandle
          orientation="vertical"
          onResize={(d) => setHeight((h) => Math.max(80, h + d))}
        />
        <div className="flex-1 border-t border-border p-4 text-sm">
          Terminal
        </div>
      </div>
    );
  },
};
