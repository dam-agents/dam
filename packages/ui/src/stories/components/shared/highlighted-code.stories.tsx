import type { Meta, StoryObj } from "@storybook/react-vite";

import { HighlightedCode } from "@/components/highlighted-code";

const meta = {
  title: "Components/Shared/HighlightedCode",
  component: HighlightedCode,
  parameters: { layout: "padded" },
  args: { path: "", code: "" },
} satisfies Meta<typeof HighlightedCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TypeScript: Story = {
  args: {
    path: "src/refunds.ts",
    code: `export async function createRefund(req: RefundRequest, db: Db) {
  const existing = await db.refunds.findByKey(req.idempotencyKey);
  if (existing) return existing;
  return db.refunds.insert(req);
}`,
  },
};

export const Yaml: Story = {
  args: {
    path: "deploy/values.yaml",
    code: `replicaCount: 2
resources:
  requests:
    cpu: "2"
    memory: 2Gi`,
  },
};

export const Json: Story = {
  args: {
    path: "package.json",
    code: `{
  "name": "checkout-service",
  "scripts": { "test": "vitest run" }
}`,
  },
};

export const Dockerfile: Story = {
  args: {
    path: "Dockerfile",
    code: `FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci
CMD ["node", "server.js"]`,
  },
};

/** Unknown extensions fall back to plain text. */
export const UnknownLanguage: Story = {
  args: {
    path: "logs/nightly-etl.log",
    code: `2026-09-18T02:00:04Z start nightly-etl run=20260918
2026-09-18T02:14:40Z done rows=1482203`,
  },
};
