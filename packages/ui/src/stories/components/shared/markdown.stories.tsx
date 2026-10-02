import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { Markdown } from "@/components/markdown";

const REPORT = `# Checkout latency regression

The p95 for \`POST /v1/checkout\` rose from **210 ms** to **540 ms** after the
Sept 18 deploy. Full numbers are in the
[latency report](platform://artifacts/art-latency-report).

## Findings

1. The new fraud check runs synchronously.
2. Retries double the load on the payments API.

| Endpoint | Before | After |
| --- | ---: | ---: |
| \`POST /v1/checkout\` | 210 ms | 540 ms |
| \`GET /v1/cart\` | 48 ms | 51 ms |

- [x] Reproduce locally
- [ ] Move the fraud check to a queue

\`\`\`ts
export async function checkout(cart: Cart) {
  await fraud.check(cart); // blocks the request
  return payments.charge(cart.total);
}
\`\`\`

> Rollback is safe: the migration is additive.

See [the runbook](./docs/runbook.md) or [the status page](https://status.example.com).
`;

const meta = {
  title: "Components/Shared/Markdown",
  component: Markdown,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[720px]">
        <Story />
      </div>
    ),
  ],
  args: { children: REPORT, onFileClick: fn() },
} satisfies Meta<typeof Markdown>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Headings, tables, task lists, code, quotes, an artifact chip and file links. */
export const Report: Story = {};

/** Skill files start with YAML frontmatter, which collapses behind a toggle. */
export const WithFrontmatter: Story = {
  args: {
    children: `---
name: code-review
description: Review a pull request for correctness bugs.
---
# Code review

Read the diff, then check each changed function against its callers.
`,
  },
};

/** Without \`onFileClick\`, relative links render as ordinary links. */
export const PlainLinks: Story = { args: { onFileClick: undefined } };
