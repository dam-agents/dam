import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { FeedArtifactChips } from "@/modules/home/components/feed-artifact-chips";

import { ago } from "../../backend/scenario";

/** Artifacts from the fixture library (`artifactLibrary.touches`). */
const TOUCHED = [
  {
    artifactId: "art-latency-report",
    fileName: "checkout-latency-september.html",
    touchedAt: ago(12),
  },
  {
    artifactId: "art-latency-chart",
    fileName: "checkout-p95.svg",
    touchedAt: ago(14),
  },
  {
    artifactId: "art-refund-design",
    fileName: "refund-idempotency.md",
    touchedAt: ago(40),
  },
  {
    artifactId: "art-refund-patch",
    fileName: "create-refund.ts",
    touchedAt: ago(42),
  },
  {
    artifactId: "art-help-digest",
    fileName: "help-platform-digest-2026-09-22.md",
    touchedAt: ago(90),
  },
];

const meta = {
  title: "Components/Home/FeedArtifactChips",
  component: FeedArtifactChips,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[640px]">
        <Story />
      </div>
    ),
  ],
  args: { artifacts: TOUCHED.slice(0, 2), onOpen: fn() },
} satisfies Meta<typeof FeedArtifactChips>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Few: Story = {};

/** More than three: the oldest collapse behind "+N more". */
export const Overflow: Story = { args: { artifacts: TOUCHED } };

/** No artifacts: renders nothing. */
export const None: Story = { args: { artifacts: [] } };
