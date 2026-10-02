import type { Meta, StoryObj } from "@storybook/react-vite";

import { GithubAppInstallButton } from "@/modules/connections/components/github-app-install-hint";

import { connectionById, GITHUB_NEEDS_INSTALL } from "./catalog-data";

const meta = {
  title: "Components/Connections/GithubAppInstallButton",
  component: GithubAppInstallButton,
  parameters: { layout: "padded" },
  args: { connection: GITHUB_NEEDS_INSTALL },
} satisfies Meta<typeof GithubAppInstallButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Active GitHub connection whose app is not installed yet. */
export const NeedsInstall: Story = {};

/** No app slug: the button renders nothing. */
export const NothingToInstall: Story = {
  args: { connection: connectionById("conn-github") },
};
