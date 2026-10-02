import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { RenameArtifactDialog } from "@/modules/artifacts/components/rename-artifact-dialog";

import { ART, getArtifact } from "./artifact-fixtures";

const loadArtifact = async () => ({ artifact: await getArtifact(ART.html) });
type Loaded = Awaited<ReturnType<typeof loadArtifact>>;

const meta = {
  title: "Components/Artifacts/RenameArtifactDialog",
  loaders: [loadArtifact],
  args: { onClose: fn() },
  render: (args, { loaded }) => (
    <RenameArtifactDialog {...args} artifact={(loaded as Loaded).artifact} />
  ),
} satisfies Meta<{ onClose: () => void }>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
