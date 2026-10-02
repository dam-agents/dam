import type { Meta, StoryObj } from "@storybook/react-vite";

import { MigrationRefusalList } from "../../../modules/agents/components/migration-plan-summary.js";

/** Why an agent can't move to the new runtime, as the disabled Migrate
 *  action's hover card lists it. The first reason is the fixture backend's. */
const meta = {
  title: "Components/Agents/MigrationRefusalList",
  component: MigrationRefusalList,
  parameters: { layout: "padded" },
  decorators: [
    (Story) => (
      <div className="max-w-[340px] text-sm text-muted-foreground">
        <Story />
      </div>
    ),
  ],
  args: {
    plan: {
      refusal: {
        type: "VirtualizationDisabled",
        reasons: ["virtualization is not enabled on this install"],
      },
    },
  },
} satisfies Meta<typeof MigrationRefusalList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OneReason: Story = {};

export const SeveralReasons: Story = {
  args: {
    plan: {
      refusal: {
        type: "PersistsUnmovablePaths",
        reasons: [
          "/var/lib/docker is persisted and can't be copied",
          "/nix is persisted and can't be copied",
        ],
      },
    },
  },
};
