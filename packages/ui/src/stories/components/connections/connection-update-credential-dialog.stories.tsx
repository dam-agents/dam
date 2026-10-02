import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ConnectionMaintenanceDialog } from "@/modules/connections/components/connection-update-credential-dialog";

import { connectionById, GITHUB_APP_CONNECTION } from "./catalog-data";

const meta = {
  title: "Components/Connections/ConnectionMaintenanceDialog",
  component: ConnectionMaintenanceDialog,
  parameters: { layout: "fullscreen" },
  args: {
    maintenance: {
      updating: connectionById("conn-anthropic"),
      closeUpdate: fn(),
    },
  },
} satisfies Meta<typeof ConnectionMaintenanceDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Replace a header connection's API key. */
export const UpdateApiKey: Story = {};

export const UpdateOAuthCredential: Story = {
  args: {
    maintenance: { updating: connectionById("conn-linear"), closeUpdate: fn() },
  },
};

/** Routes to the GitHub user-token scope dialog. */
export const EditGithubOAuthScope: Story = {
  args: {
    maintenance: {
      updating: null,
      closeUpdate: fn(),
      editingScope: connectionById("conn-github"),
      closeEditScope: fn(),
    },
  },
};

/** Routes to the GitHub App scope dialog. */
export const EditGithubAppScope: Story = {
  args: {
    maintenance: {
      updating: null,
      closeUpdate: fn(),
      editingScope: GITHUB_APP_CONNECTION,
      closeEditScope: fn(),
    },
  },
};
