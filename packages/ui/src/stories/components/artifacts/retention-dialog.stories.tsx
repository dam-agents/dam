import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { RetentionDialog } from "@/modules/artifacts/components/retention-dialog";

import { ART, getArtifact } from "./artifact-fixtures";

type Args = { onClose: () => void; scheduled: boolean };

const loadArtifacts = async () => ({
  kept: await getArtifact(ART.html),
  scheduled: await getArtifact(ART.expiring),
});
type Loaded = Awaited<ReturnType<typeof loadArtifacts>>;

const meta = {
  title: "Components/Artifacts/RetentionDialog",
  loaders: [loadArtifacts],
  args: { onClose: fn(), scheduled: false },
  render: ({ scheduled, ...args }, { loaded }) => {
    const l = loaded as Loaded;
    return (
      <RetentionDialog {...args} artifact={scheduled ? l.scheduled : l.kept} />
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No deletion date set. */
export const NeverDeleted: Story = {};
/** Already scheduled: offers "Keep current date". */
export const Scheduled: Story = { args: { scheduled: true } };
