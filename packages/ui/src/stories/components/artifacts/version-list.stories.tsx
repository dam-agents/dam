import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { VersionList } from "@/modules/artifacts/components/version-list";

import { ART, getArtifact, listVersions } from "./artifact-fixtures";

type Args = {
  artifactId: string;
  current: number;
  onChange: (v: number) => void;
};

const VERSIONED = [ART.html, ART.restricted, ART.csv] as const;

const loadVersions = async () => ({
  byId: Object.fromEntries(
    await Promise.all(
      VERSIONED.map(
        async (id) =>
          [
            id,
            {
              artifact: await getArtifact(id),
              versions: await listVersions(id),
            },
          ] as const,
      ),
    ),
  ),
});
type Loaded = Awaited<ReturnType<typeof loadVersions>>;

/** Version history list shown in the VersionSwitcher popover. */
const meta = {
  title: "Components/Artifacts/VersionList",
  parameters: { layout: "padded" },
  loaders: [loadVersions],
  args: { artifactId: ART.html, current: 3, onChange: fn() },
  argTypes: { artifactId: { control: "select", options: VERSIONED } },
  render: ({ artifactId, ...args }, { loaded }) => {
    const { artifact, versions } = (loaded as Loaded).byId[artifactId]!;
    return (
      <div className="inline-block rounded-md border border-border bg-popover">
        <VersionList {...args} artifact={artifact} versions={versions} />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Latest selected. */
export const Latest: Story = {};
/** An older version pinned. */
export const OlderSelected: Story = { args: { current: 1 } };
/** Five versions; newest edited by you. */
export const EditedByYou: Story = { args: { artifactId: ART.csv, current: 5 } };
