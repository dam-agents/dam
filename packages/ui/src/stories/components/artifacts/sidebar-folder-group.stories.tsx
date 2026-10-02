import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { SidebarFolderGroup } from "@/modules/artifacts/components/sidebar-folder-group";

import { listFolders } from "./artifact-fixtures";

/**
 * Folder header in the chat sidebar's Artifacts panel. Its rows are private
 * to `ChatArtifactsPanel`, so these stories show the header only — see
 * ChatArtifactsPanel for it with rows.
 */
type Args = Omit<
  ComponentProps<typeof SidebarFolderGroup>,
  "folderId" | "label" | "count" | "children"
>;

const loadFolder = async () => ({ folder: (await listFolders())[0]! });
type Loaded = Awaited<ReturnType<typeof loadFolder>>;

const meta = {
  title: "Components/Artifacts/SidebarFolderGroup",
  parameters: { layout: "padded" },
  loaders: [loadFolder],
  args: { collapsed: true, onToggle: fn(), dropActive: false },
  render: (args, { loaded }) => {
    const { folder } = loaded as Loaded;
    return (
      <div className="w-72 border border-border bg-card">
        <SidebarFolderGroup
          {...args}
          folderId={folder.id}
          label={folder.name}
          count={folder.artifactCount}
        >
          {null}
        </SidebarFolderGroup>
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Collapsed: Story = {};
export const Expanded: Story = { args: { collapsed: false } };
/** Highlighted while an artifact is dragged over it. */
export const DropActive: Story = { args: { dropActive: true } };
