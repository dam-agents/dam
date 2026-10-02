import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import { IconRail } from "@/components/icon-rail";
import { type PlatformStore, useStore } from "@/store";

/** The rail reads the current view and expanded flag from the store. */
const withNav =
  (
    nav: Pick<PlatformStore, "view" | "sidebarExpanded">,
  ): Decorator<Parameters<typeof IconRail>[0]> =>
  (Story) => {
    useStore.setState(nav);
    return (
      <div className="flex h-screen">
        <Story />
        <div className="flex-1 bg-background" />
      </div>
    );
  };

const meta = {
  title: "Components/Shared/IconRail",
  component: IconRail,
} satisfies Meta<typeof IconRail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {
  decorators: [withNav({ view: "home", sidebarExpanded: false })],
};

export const Expanded: Story = {
  decorators: [withNav({ view: "home", sidebarExpanded: true })],
};

/** Starter Kits carries the kit tone, active and inactive. */
export const StarterKitsActive: Story = {
  decorators: [withNav({ view: "starter-kits", sidebarExpanded: true })],
};

export const SettingsActive: Story = {
  decorators: [withNav({ view: "settings", sidebarExpanded: false })],
};

/** Below the md breakpoint the rail becomes a bottom tab bar. Pick a mobile
 *  viewport in the toolbar to see it. */
export const MobileBar: Story = {
  decorators: [withNav({ view: "artifacts", sidebarExpanded: false })],
  globals: { viewport: { value: "mobile1", isRotated: false } },
};
