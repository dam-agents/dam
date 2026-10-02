import type { Meta, StoryObj } from "@storybook/react-vite";

import { Markdown } from "@/components/markdown";
import { MarkdownCodeBlock } from "@/components/markdown-code-block";

/** MarkdownCodeBlock is the `pre` renderer react-markdown hands a parsed code
 *  node to, so it is shown through `<Markdown>` with a fenced block. Hover the
 *  block to reveal the copy button. */
const meta = {
  title: "Components/Shared/MarkdownCodeBlock",
  component: MarkdownCodeBlock,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[720px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MarkdownCodeBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TypeScript: Story = {
  render: () => (
    <Markdown>
      {`\`\`\`ts
export async function createRefund(req: RefundRequest, db: Db) {
  const existing = await db.refunds.findByKey(req.idempotencyKey);
  if (existing) return existing;
  return db.refunds.insert(req);
}
\`\`\``}
    </Markdown>
  ),
};

export const Shell: Story = {
  render: () => (
    <Markdown>
      {`\`\`\`bash
kubectl rollout status deploy/checkout -n payments
\`\`\``}
    </Markdown>
  ),
};

/** No language tag: plain, unhighlighted text. */
export const PlainText: Story = {
  render: () => (
    <Markdown>
      {`\`\`\`
2026-09-18T02:00:04Z start nightly-etl run=20260918
2026-09-18T02:14:40Z done rows=1482203
\`\`\``}
    </Markdown>
  ),
};
