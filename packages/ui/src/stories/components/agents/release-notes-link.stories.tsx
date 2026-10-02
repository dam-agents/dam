import type { Meta, StoryObj } from "@storybook/react-vite";

import { ReleaseNotesLink } from "../../../modules/agents/components/release-notes-link.js";

/** Renders nothing unless `href` is an external http(s) URL. The URL here is
 *  the Claude Code template's `releaseNotesUrl` from the fixtures. */
const meta = {
  title: "Components/Agents/ReleaseNotesLink",
  component: ReleaseNotesLink,
  parameters: { layout: "centered" },
  args: { href: "https://code.claude.com/docs/en/whats-new" },
} satisfies Meta<typeof ReleaseNotesLink>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NoUrl: Story = { args: { href: null } };
