import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentProps } from "react";
import { fn } from "storybook/test";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ArtifactRowMenuItems } from "@/modules/artifacts/components/artifact-row-menu-items";

import { ART, getArtifact } from "./artifact-fixtures";

type Args = Omit<ComponentProps<typeof ArtifactRowMenuItems>, "artifact"> & {
  artifactId: string;
};

const loadArtifacts = async () => ({
  artifacts: Object.fromEntries(
    await Promise.all(
      Object.values(ART).map(
        async (id) => [id, await getArtifact(id)] as const,
      ),
    ),
  ),
});
type Loaded = Awaited<ReturnType<typeof loadArtifacts>>;

/** The overflow menu shared by library rows and the chat sidebar, shown open. */
const meta = {
  title: "Components/Artifacts/ArtifactRowMenuItems",
  parameters: { layout: "padded" },
  loaders: [loadArtifacts],
  args: {
    artifactId: ART.restricted,
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
    return (
      <div className="flex h-96 justify-end pr-40">
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              More actions
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <ArtifactRowMenuItems {...args} artifact={artifacts[artifactId]!} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Text artifact: includes Edit. */
export const Editable: Story = {};
/** Binary image: no Edit. */
export const Binary: Story = { args: { artifactId: ART.image } };
