import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { UploadArtifactDialog } from "@/modules/artifacts/components/upload-artifact-dialog";

import { listFolders } from "./artifact-fixtures";

type Args = { onClose: () => void; withFolders: boolean };

const loadFolders = async () => ({ folders: await listFolders() });
type Loaded = Awaited<ReturnType<typeof loadFolders>>;

const meta = {
  title: "Components/Artifacts/UploadArtifactDialog",
  loaders: [loadFolders],
  args: { onClose: fn(), withFolders: true },
  render: ({ withFolders, ...args }, { loaded }) => (
    <UploadArtifactDialog
      {...args}
      folders={withFolders ? (loaded as Loaded).folders : []}
    />
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithFolders: Story = {};
export const NoFolders: Story = { args: { withFolders: false } };
