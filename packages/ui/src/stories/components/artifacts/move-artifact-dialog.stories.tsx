import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { MoveArtifactDialog } from "@/modules/artifacts/components/move-artifact-dialog";

import { ART, getArtifact, scenarioLoader } from "./artifact-fixtures";

type Args = { onClose: () => void; artifactId: string };

const loadArtifacts = async () => ({
  inFolder: await getArtifact(ART.html),
  ungrouped: await getArtifact(ART.code),
});
type Loaded = Awaited<ReturnType<typeof loadArtifacts>>;

/** Fetches the folder list itself. */
const meta = {
  title: "Components/Artifacts/MoveArtifactDialog",
  loaders: [scenarioLoader, loadArtifacts],
  args: { onClose: fn(), artifactId: ART.html },
  render: ({ artifactId, ...args }, { loaded }) => {
    const { inFolder, ungrouped } = loaded as Loaded;
    return (
      <MoveArtifactDialog
        {...args}
        artifact={artifactId === ART.code ? ungrouped : inFolder}
      />
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Already in "Reports". */
export const InFolder: Story = {};
/** Not in any folder yet. */
export const Ungrouped: Story = { args: { artifactId: ART.code } };
