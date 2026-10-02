import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { FolderDialog } from "@/modules/artifacts/components/folder-dialog";

import { listFolders } from "./artifact-fixtures";

type Args = { onClose: () => void; editing: boolean };

const loadFolder = async () => ({ folder: (await listFolders())[0]! });
type Loaded = Awaited<ReturnType<typeof loadFolder>>;

const meta = {
  title: "Components/Artifacts/FolderDialog",
  loaders: [loadFolder],
  args: { onClose: fn(), editing: false },
  render: ({ editing, ...args }, { loaded }) => (
    <FolderDialog
      key={String(editing)}
      {...args}
      folder={editing ? (loaded as Loaded).folder : null}
    />
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const NewFolder: Story = {};
/** Editing the fixture "Reports" folder. */
export const EditFolder: Story = { args: { editing: true } };
