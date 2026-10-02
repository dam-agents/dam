import type { Meta, StoryObj } from "@storybook/react-vite";

import { AppVersionRow } from "@/modules/settings/components/app-version-row";

const meta = {
  title: "Components/Settings/AppVersionRow",
  component: AppVersionRow,
  parameters: { layout: "padded" },
} satisfies Meta<typeof AppVersionRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
