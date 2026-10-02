import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@/components/ui/button";
import { LifecycleField } from "@/modules/sandboxes/components/lifecycle-field";
import { StickyFooterLayout } from "@/modules/sandboxes/components/sticky-footer-layout";

/** The sandbox page frame: scrolling content above a pinned action bar. */
const meta = {
  title: "Components/Sandboxes/StickyFooterLayout",
  component: StickyFooterLayout,
  decorators: [
    (Story) => (
      <div className="h-screen">
        <Story />
      </div>
    ),
  ],
  args: {
    footerClassName: "max-w-[1040px]",
    children: (
      <div className="mx-auto w-full max-w-[1040px] px-4 pt-6 pb-8 md:px-8 md:pt-12">
        <LifecycleField value={60} onChange={() => {}} />
      </div>
    ),
    footer: <Button>Submit changes</Button>,
  },
} satisfies Meta<typeof StickyFooterLayout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithFooter: Story = {};
export const WithoutFooter: Story = { args: { footer: undefined } };
