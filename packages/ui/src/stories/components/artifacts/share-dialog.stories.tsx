import type { Meta, StoryObj } from "@storybook/react-vite";
import type { LibraryArtifact } from "api-server-api";
import { fn } from "storybook/test";

import { ShareDialog } from "@/modules/artifacts/components/share-dialog";

import { ART, getArtifact } from "./artifact-fixtures";

type Args = { onClose: () => void; artifactId: string };

const loadArtifacts = async (): Promise<{
  artifacts: Record<string, LibraryArtifact>;
}> => ({
  artifacts: {
    [ART.code]: await getArtifact(ART.code),
    [ART.restricted]: await getArtifact(ART.restricted),
    [ART.html]: await getArtifact(ART.html),
  },
});
type Loaded = Awaited<ReturnType<typeof loadArtifacts>>;

const meta = {
  title: "Components/Artifacts/ShareDialog",
  loaders: [loadArtifacts],
  args: { onClose: fn(), artifactId: ART.code },
  argTypes: {
    artifactId: {
      control: "select",
      options: [ART.code, ART.restricted, ART.html],
    },
  },
  render: ({ artifactId, ...args }, { loaded }) => (
    <ShareDialog
      {...args}
      artifact={(loaded as Loaded).artifacts[artifactId]!}
    />
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Private: Story = {};
/** Restricted, with the fixture's two viewers. */
export const Restricted: Story = { args: { artifactId: ART.restricted } };
/** Public, with its share link. */
export const Public: Story = { args: { artifactId: ART.html } };

/**
 * Interactive pages can't be shared. No fixture artifact is interactive, so
 * this flips the flag on a fixture artifact.
 */
export const Interactive: Story = {
  render: (args, { loaded }) => {
    const artifact = (loaded as Loaded).artifacts[ART.html]!;
    return (
      <ShareDialog
        onClose={args.onClose}
        artifact={{
          ...artifact,
          interactive: true,
          visibility: "private",
          shareUrl: null,
        }}
      />
    );
  },
};
