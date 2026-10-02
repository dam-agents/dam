import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";

import { TraceWaterfall } from "../../../modules/telemetry/components/trace-waterfall.js";
import { TURN_DETAIL } from "./turn-detail-fixture";

/** One turn's spans and records on a time axis. Click a row to select it. */
const meta = {
  title: "Components/Telemetry/TraceWaterfall",
  component: TraceWaterfall,
  parameters: { layout: "padded" },
  args: { turn: TURN_DETAIL, selectedKey: null, onSelect: fn() },
  render: function Render(args) {
    const [selected, setSelected] = useState(args.selectedKey);
    return (
      <div className="max-w-[813px] rounded-md border border-border bg-muted/20">
        <TraceWaterfall
          {...args}
          selectedKey={selected}
          onSelect={(key) => {
            setSelected((k) => (k === key ? null : key));
            args.onSelect(key);
          }}
        />
      </div>
    );
  },
} satisfies Meta<typeof TraceWaterfall>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithSelection: Story = {
  args: {
    selectedKey: `span:${TURN_DETAIL.spans.find((s) => s.name === "claude_code.tool")!.spanId}`,
  },
};

export const Empty: Story = {
  args: { turn: { ...TURN_DETAIL, spans: [], logs: [] } },
};
