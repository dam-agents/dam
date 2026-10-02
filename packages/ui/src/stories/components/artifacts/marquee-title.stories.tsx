import type { Meta, StoryObj } from "@storybook/react-vite";

import { MarqueeTitle } from "@/modules/artifacts/components/marquee-title";

import { ART, getArtifact } from "./artifact-fixtures";

type Args = { animate?: boolean; width: number };

const loadTitle = async () => ({
  text: (await getArtifact(ART.expiring)).title,
});
type Loaded = Awaited<ReturnType<typeof loadTitle>>;

/** Title that scrolls when it overflows and `animate` is on (row hovered or active). */
const meta = {
  title: "Components/Artifacts/MarqueeTitle",
  parameters: { layout: "padded" },
  loaders: [loadTitle],
  args: { animate: true, width: 160 },
  render: ({ width, ...args }, { loaded }) => (
    <div
      className="flex rounded border border-border px-3 py-1 text-sm text-muted-foreground"
      style={{ width }}
    >
      <MarqueeTitle
        {...args}
        text={(loaded as Loaded).text}
        className="min-w-0 flex-1"
      />
    </div>
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Overflowing and animating. */
export const Scrolling: Story = {};
/** Overflowing, not animated: ellipsis. */
export const Truncated: Story = { args: { animate: false } };
/** Fits: no scroll, no ellipsis. */
export const Fits: Story = { args: { width: 400 } };
