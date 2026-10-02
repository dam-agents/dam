import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ConnectionCatalogModal } from "@/modules/connections/components/connection-catalog-modal";

import { AGENTS } from "../../backend/fixtures/agents";

const codingAgent = AGENTS[0]!;

const meta = {
  title: "Components/Connections/ConnectionCatalogModal",
  component: ConnectionCatalogModal,
  parameters: { layout: "fullscreen" },
  args: { onClose: fn() },
} satisfies Meta<typeof ConnectionCatalogModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Settings: browse and manage every connection. */
export const Browse: Story = {};

/** Opened from an agent: rows can be added to or removed from it. */
export const ForAgent: Story = {
  args: {
    sandbox: {
      grantedIds: new Set(codingAgent.grantedConnectionIds),
      onToggleGrant: fn(),
    },
    title: `Connections for ${codingAgent.name}`,
  },
};

/** Deep-linked straight into a provider's create pane. */
export const CreateGithub: Story = { args: { initialProviderId: "github" } };

export const CreateMcpServer: Story = {
  args: { initialProviderId: "mcp-server" },
};

/** Narrowed to what a requirement accepts (no tabs). */
export const NarrowedByAccepts: Story = {
  args: {
    accepts: ["github", "github-pat", "github-app"],
    title: "Connect GitHub",
    subtitle: "This agent needs a GitHub connection",
  },
};

export const NothingAccepted: Story = {
  args: { accepts: ["not-offered-here"] },
};
