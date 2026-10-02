import type { Meta, StoryObj } from "@storybook/react-vite";

import { ShareLinkRow } from "@/modules/artifacts/components/share-link-row";

import { ART, getArtifact } from "./artifact-fixtures";

const loadShareUrl = async () => ({
  shareUrl: (await getArtifact(ART.html)).shareUrl!,
});
type Loaded = Awaited<ReturnType<typeof loadShareUrl>>;

const meta = {
  title: "Components/Artifacts/ShareLinkRow",
  parameters: { layout: "padded" },
  loaders: [loadShareUrl],
  render: (_, { loaded }) => (
    <div className="max-w-md">
      <ShareLinkRow shareUrl={(loaded as Loaded).shareUrl} />
    </div>
  ),
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
