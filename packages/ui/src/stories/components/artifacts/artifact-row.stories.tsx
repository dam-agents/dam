import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { ArtifactRow } from "@/modules/artifacts/components/artifact-row";

import { ago } from "../../backend/scenario";
import { ART, getArtifact, listArtifacts } from "./artifact-fixtures";

/** `artifact` comes from the fake backend (loader), picked per story. */
type Args = Omit<ComponentProps<typeof ArtifactRow>, "artifact"> & {
  artifactId: string;
};

const loadArtifacts = async () => ({ artifacts: await listArtifacts() });
type Loaded = Awaited<ReturnType<typeof loadArtifacts>>;

const meta = {
  title: "Components/Artifacts/ArtifactRow",
  parameters: { layout: "padded" },
  loaders: [loadArtifacts],
  args: {
    artifactId: ART.html,
    showAgent: true,
    onPreview: fn(),
    onEdit: fn(),
    onRename: fn(),
    onMove: fn(),
    onShare: fn(),
    onSetRetention: fn(),
  },
  argTypes: {
    artifactId: { control: "select", options: Object.values(ART) },
  },
  render: ({ artifactId, ...args }, { loaded }) => {
    const { artifacts } = loaded as Loaded;
    const artifact = artifacts.find((a) => a.id === artifactId)!;
    return (
      <div className="max-w-3xl overflow-hidden rounded-lg border border-border bg-card">
        <ArtifactRow {...args} artifact={artifact} />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Public HTML with views and a copy-link button. */
export const Public: Story = {};
/** Restricted to named viewers. */
export const Restricted: Story = { args: { artifactId: ART.restricted } };
/** Private — no share link. */
export const Private: Story = { args: { artifactId: ART.code } };
/** Scheduled for automatic deletion. */
export const ScheduledDeletion: Story = { args: { artifactId: ART.expiring } };
/** Inside one agent's page, the creator chip is hidden. */
export const WithoutAgent: Story = { args: { showAgent: false } };

/** Every fixture artifact, as the library list stacks them. */
export const List: Story = {
  render: (args, { loaded }) => {
    const { artifacts } = loaded as Loaded;
    return (
      <div className="max-w-3xl overflow-hidden rounded-lg border border-border bg-card">
        {artifacts.map((artifact) => (
          <ArtifactRow key={artifact.id} {...args} artifact={artifact} />
        ))}
      </div>
    );
  },
};

/** Expired artifacts render dimmed. Fixture artifact with a past `expiresAt`. */
export const Expired: Story = {
  loaders: [
    async () => {
      const artifact = await getArtifact(ART.expiring);
      return {
        expired: { ...artifact, expiresAt: ago(60) },
      };
    },
  ],
  render: (args, { loaded }) => (
    <div className="max-w-3xl overflow-hidden rounded-lg border border-border bg-card">
      <ArtifactRow
        {...args}
        artifact={(loaded as { expired: Loaded["artifacts"][number] }).expired}
      />
    </div>
  ),
};
