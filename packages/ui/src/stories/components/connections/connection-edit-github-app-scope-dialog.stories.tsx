import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ConnectionEditGithubAppScopeDialog } from "@/modules/connections/components/connection-edit-github-app-scope-dialog";

import { GITHUB_APP_CONNECTION } from "./catalog-data";

const meta = {
  title: "Components/Connections/ConnectionEditGithubAppScopeDialog",
  component: ConnectionEditGithubAppScopeDialog,
  parameters: { layout: "fullscreen" },
  args: { connection: GITHUB_APP_CONNECTION, onClose: fn() },
} satisfies Meta<typeof ConnectionEditGithubAppScopeDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Opens by probing the installation (`probeGitHubAppInstallationForConnection`). */
export const Default: Story = {};
