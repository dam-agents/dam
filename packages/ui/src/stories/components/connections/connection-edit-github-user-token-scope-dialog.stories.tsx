import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ConnectionEditGithubUserTokenScopeDialog } from "@/modules/connections/components/connection-edit-github-user-token-scope-dialog";

import { connectionById } from "./catalog-data";

const meta = {
  title: "Components/Connections/ConnectionEditGithubUserTokenScopeDialog",
  component: ConnectionEditGithubUserTokenScopeDialog,
  parameters: { layout: "fullscreen" },
  args: { connection: connectionById("conn-github"), onClose: fn() },
} satisfies Meta<typeof ConnectionEditGithubUserTokenScopeDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens by probing the token (`probeGitHubUserTokenForConnection`). */
export const Default: Story = {};
