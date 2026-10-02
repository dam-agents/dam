import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { api } from "@/api";
import { ArtifactSourceView } from "@/modules/artifacts/components/artifact-source-view";

import { ART, getArtifact } from "./artifact-fixtures";

type Args = { artifactId: string };

const IDS = [ART.code, ART.restricted, ART.csv, ART.image] as const;

const loadSources = async () => ({
  sources: Object.fromEntries(
    await Promise.all(
      IDS.map(
        async (id) =>
          [
            id,
            {
              artifact: await getArtifact(id),
              content: await api.artifactLibrary.getContent.query({ id }),
            },
          ] as const,
      ),
    ),
  ),
});
type Loaded = Awaited<ReturnType<typeof loadSources>>;

/** Source / non-rendered body of the preview dialog and docked panel. */
const meta = {
  title: "Components/Artifacts/ArtifactSourceView",
  parameters: { layout: "padded" },
  loaders: [loadSources],
  args: { artifactId: ART.code },
  argTypes: { artifactId: { control: "select", options: IDS } },
  render: ({ artifactId }, { loaded }) => {
    const { artifact, content } = (loaded as Loaded).sources[artifactId]!;
    return (
      <div className="max-w-3xl">
        <ArtifactSourceView
          artifact={artifact}
          content={content}
          isLoading={false}
        />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Highlighted TypeScript. */
export const Code: Story = {};
export const Markdown: Story = { args: { artifactId: ART.restricted } };
export const Csv: Story = { args: { artifactId: ART.csv } };
/** Binary image shown inline. */
export const Image: Story = { args: { artifactId: ART.image } };

export const Loading: Story = {
  render: ({ artifactId }, { loaded }) => (
    <ArtifactSourceView
      artifact={(loaded as Loaded).sources[artifactId]!.artifact}
      content={undefined}
      isLoading
    />
  ),
};

/** Content flagged too large to inline. */
export const TooLarge: Story = {
  render: ({ artifactId }, { loaded }) => {
    const { artifact, content } = (loaded as Loaded).sources[artifactId]!;
    return (
      <ArtifactSourceView
        artifact={artifact}
        content={{ ...content, tooLarge: true }}
        isLoading={false}
      />
    );
  },
};

/** In-place editor (edit mode). */
export const Editing: Story = {
  render: ({ artifactId }, { loaded }) => {
    const { artifact, content } = (loaded as Loaded).sources[artifactId]!;
    return (
      <div className="h-[480px] max-w-3xl">
        <ArtifactSourceView
          artifact={artifact}
          content={content}
          isLoading={false}
          editMode
          draft={content.content}
          onDraftChange={fn()}
          onSave={fn()}
        />
      </div>
    );
  },
};
