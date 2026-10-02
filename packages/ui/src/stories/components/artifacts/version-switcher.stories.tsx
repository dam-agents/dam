import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { VersionSwitcher } from "@/modules/artifacts/components/version-switcher";

import { ART, getArtifact, listVersions } from "./artifact-fixtures";

type Args = { current: number; withHistory: boolean };

const loadVersions = async () => ({
  artifact: await getArtifact(ART.html),
  versions: await listVersions(ART.html),
});
type Loaded = Awaited<ReturnType<typeof loadVersions>>;

/** Older / newer stepper; the label opens the history list. Hidden for one version. */
const meta = {
  title: "Components/Artifacts/VersionSwitcher",
  parameters: { layout: "padded" },
  loaders: [loadVersions],
  args: { current: 3, withHistory: true },
  render: function Render({ current, withHistory }, { loaded }) {
    const { artifact, versions } = loaded as Loaded;
    const [version, setVersion] = useState(current);
    return (
      <div className="flex justify-end pr-20">
        <VersionSwitcher
          artifact={artifact}
          versions={withHistory ? versions : undefined}
          current={version}
          total={versions.length}
          onChange={setVersion}
        />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** On the latest version: "Newer" disabled. */
export const Latest: Story = {};
/** On the oldest version: "Older" disabled. */
export const Oldest: Story = { args: { current: 1 } };
/** Versions not loaded yet: plain label, no popover. */
export const WithoutHistory: Story = { args: { withHistory: false } };
