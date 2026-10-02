import type { Meta, StoryObj } from "@storybook/react-vite";

import { CopyLinkButton } from "@/modules/artifacts/components/copy-link-button";

import { ART, getArtifact } from "./artifact-fixtures";

type Args = { variant: "ghost" | "outline"; restricted?: boolean };

const loadShareUrls = async () => ({
  publicUrl: (await getArtifact(ART.html)).shareUrl!,
  restrictedUrl: (await getArtifact(ART.restricted)).shareUrl!,
});
type Loaded = Awaited<ReturnType<typeof loadShareUrls>>;

const meta = {
  title: "Components/Artifacts/CopyLinkButton",
  parameters: { layout: "padded" },
  loaders: [loadShareUrls],
  args: { variant: "outline", restricted: false },
  argTypes: {
    variant: { control: "inline-radio", options: ["ghost", "outline"] },
  },
  render: (args, { loaded }) => {
    const { publicUrl, restrictedUrl } = loaded as Loaded;
    return (
      <CopyLinkButton
        {...args}
        url={args.restricted ? restrictedUrl : publicUrl}
      />
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Outline: Story = {};
export const Ghost: Story = { args: { variant: "ghost" } };
/** Tooltip says only listed people can open it. */
export const Restricted: Story = { args: { restricted: true } };
