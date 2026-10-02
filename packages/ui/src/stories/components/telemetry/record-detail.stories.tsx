import type { Meta, StoryObj } from "@storybook/react-vite";

import { RecordDetail } from "../../../modules/telemetry/components/record-detail.js";
import { TURN_DETAIL } from "./turn-detail-fixture";

const byEvent = (event: string) =>
  TURN_DETAIL.logs.find((l) => l.event === event)!;

/** The panel under the waterfall for a selected log record. */
const meta = {
  title: "Components/Telemetry/RecordDetail",
  component: RecordDetail,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[813px] rounded-md border border-border bg-muted/20">
        <Story />
      </div>
    ),
  ],
  args: { log: byEvent("claude_code.api_request") },
} satisfies Meta<typeof RecordDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Matched to its model call by request id. */
export const ApiRequest: Story = {};

/** Emitted inside the tool span. */
export const ToolResult: Story = {
  args: { log: byEvent("claude_code.tool_result") },
};

/** No link recorded: placed by timestamp only. */
export const UserPrompt: Story = {
  args: { log: byEvent("claude_code.user_prompt") },
};
