import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { ArtifactPreviewDialog } from "@/modules/artifacts/components/artifact-preview-dialog";

import { ART, getArtifact } from "./artifact-fixtures";

type Args = { artifactId: string; initialEdit?: boolean; onClose: () => void };

const SHOWN = [ART.html, ART.restricted, ART.code, ART.image, ART.jsx] as const;

const loadArtifacts = async () => ({
  artifacts: Object.fromEntries(
    await Promise.all(
      SHOWN.map(async (id) => [id, await getArtifact(id)] as const),
    ),
  ),
});
type Loaded = Awaited<ReturnType<typeof loadArtifacts>>;

/** Library preview modal; fetches preview, content and versions itself. */
const meta = {
  title: "Components/Artifacts/ArtifactPreviewDialog",
  loaders: [loadArtifacts],
  args: { artifactId: ART.html, onClose: fn() },
  argTypes: { artifactId: { control: "select", options: SHOWN } },
  render: ({ artifactId, ...args }, { loaded }) => (
    <ArtifactPreviewDialog
      key={`${artifactId}-${args.initialEdit}`}
      {...args}
      artifact={(loaded as Loaded).artifacts[artifactId]!}
    />
  ),
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Public HTML, 3 versions, copy link, rendered preview. */
export const RenderedHtml: Story = {};
/** Restricted Markdown, 2 versions. */
export const Markdown: Story = { args: { artifactId: ART.restricted } };
/** Private code: source view only. */
export const Code: Story = { args: { artifactId: ART.code } };
/** Binary image. */
export const Image: Story = { args: { artifactId: ART.image } };
export const Jsx: Story = { args: { artifactId: ART.jsx } };
/** Opened straight into the editor. */
export const Editing: Story = {
  args: { artifactId: ART.code, initialEdit: true },
};
