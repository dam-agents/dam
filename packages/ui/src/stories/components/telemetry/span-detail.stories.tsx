import type { Meta, StoryObj } from "@storybook/react-vite";

import { SpanDetail } from "../../../modules/telemetry/components/record-detail.js";
import { TURN_DETAIL } from "./turn-detail-fixture";

const spans = TURN_DETAIL.spans;

/** The panel under the waterfall for a selected span, with the records
 *  attached to it. */
const meta = {
  title: "Components/Telemetry/SpanDetail",
  component: SpanDetail,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[813px] rounded-md border border-border bg-muted/20">
        <Story />
      </div>
    ),
  ],
  args: {
    trace: TURN_DETAIL,
    span: spans.find((s) => s.name === "claude_code.llm_request")!,
  },
} satisfies Meta<typeof SpanDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ModelCall: Story = {};

export const ToolCall: Story = {
  args: { span: spans.find((s) => s.name === "claude_code.tool")! },
};

/** The transcript's failing `pnpm vitest` run. */
export const FailedToolCall: Story = {
  args: {
    span: spans.find(
      (s) => s.name === "claude_code.tool" && s.statusCode.includes("ERROR"),
    )!,
  },
};

export const Interaction: Story = {
  args: { span: spans.find((s) => s.name === "claude_code.interaction")! },
};
