import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { FolderGroup } from "@/modules/artifacts/components/folder-group";
import { folderDisplayNames } from "@/modules/artifacts/lib/folders";
import { groupArtifactsByFolder } from "@/modules/artifacts/lib/group-artifacts";

import { listArtifacts, listFolders } from "./artifact-fixtures";

type Args = Omit<ComponentProps<typeof FolderGroup>, "folder" | "artifacts"> & {
  folderId: string | null;
};

const loadLibrary = async () => ({
  artifacts: await listArtifacts(),
  folders: await listFolders(),
});
type Loaded = Awaited<ReturnType<typeof loadLibrary>>;

const meta = {
  title: "Components/Artifacts/FolderGroup",
  parameters: { layout: "padded" },
  loaders: [loadLibrary],
  args: {
    folderId: "fld-reports",
    defaultCollapsed: false,
    nested: false,
    showAgent: true,
    onPreview: fn(),
    onEdit: fn(),
    onRename: fn(),
    onMove: fn(),
    onShare: fn(),
    onSetRetention: fn(),
    onEditFolder: fn(),
    onDeleteFolder: fn(),
    onCopyFolderLink: fn(async () => null),
  },
  argTypes: {
    folderId: {
      control: "select",
      options: [null, "fld-reports", "fld-design-docs", "fld-platform-docs"],
    },
  },
  render: ({ folderId, ...args }, { loaded }) => {
    const { artifacts, folders } = loaded as Loaded;
    return (
      <div className="max-w-3xl">
        <FolderGroup
          {...args}
          folder={folders.find((f) => f.id === folderId) ?? null}
          artifacts={artifacts.filter((a) => a.folderId === folderId)}
        />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A folder card with a "shared" count and the folder actions menu (on hover). */
export const Folder: Story = {};
export const Collapsed: Story = { args: { defaultCollapsed: true } };
/** Artifacts in no folder. */
export const Ungrouped: Story = { args: { folderId: null } };
/** Highlighted as a drop target while a row is dragged over it. */
export const DropActive: Story = { args: { dropActive: true } };

/** No artifacts in the folder. */
export const Empty: Story = {
  render: ({ folderId, ...args }, { loaded }) => {
    const { folders } = loaded as Loaded;
    return (
      <div className="max-w-3xl">
        <FolderGroup
          {...args}
          folder={folders.find((f) => f.id === folderId) ?? null}
          artifacts={[]}
        />
      </div>
    );
  },
};

/** Nested inside a parent card, grouped as on an agent's Artifacts tab. */
export const Nested: Story = {
  args: { nested: true, showAgent: false },
  render: (args, { loaded }) => {
    const { artifacts, folders } = loaded as Loaded;
    const names = folderDisplayNames(folders);
    return (
      <div className="max-w-3xl overflow-hidden rounded-lg border border-border bg-card">
        {groupArtifactsByFolder(artifacts, folders).map((group) => (
          <FolderGroup
            key={group.key}
            {...args}
            folder={group.folder}
            artifacts={group.artifacts}
            displayName={group.folder ? names.get(group.folder.id) : undefined}
            defaultCollapsed={group.artifacts.length === 0}
          />
        ))}
      </div>
    );
  },
};
