import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { PlatformSkillNote } from "@/modules/sandboxes/components/skills/platform-skill-note";

const meta = {
  title: "Components/Sandboxes/Skills/PlatformSkillNote",
  component: PlatformSkillNote,
  parameters: { layout: "padded" },
  args: { featureId: "schedules" },
} satisfies Meta<typeof PlatformSkillNote>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Schedules: Story = {};
export const Invocations: Story = { args: { featureId: "invocations" } };
export const ModelProviders: Story = { args: { featureId: "connections" } };
/** With the "View in Skills" link, as the schedules panel shows it. */
export const WithSkillsLink: Story = { args: { onOpenSkills: fn() } };
