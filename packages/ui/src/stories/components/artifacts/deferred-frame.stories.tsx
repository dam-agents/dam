import type { Meta, StoryObj } from "@storybook/react-vite";

import { api } from "@/api";
import { DeferredFrame } from "@/modules/artifacts/components/deferred-frame";

import { ART, getArtifact } from "./artifact-fixtures";

type Args = { artifactId: string; deferMs?: number };

const RENDERED = [ART.html, ART.restricted, ART.jsx] as const;

const loadPreviews = async () => ({
  previews: Object.fromEntries(
    await Promise.all(
      RENDERED.map(
        async (id) =>
          [
            id,
            {
              title: (await getArtifact(id)).title,
              html: (await api.artifactLibrary.preview.query({ id }))!,
            },
          ] as const,
      ),
    ),
  ),
});
type Loaded = Awaited<ReturnType<typeof loadPreviews>>;

/** Sandboxed iframe for a rendered artifact; mounts after the modal animation. */
const meta = {
  title: "Components/Artifacts/DeferredFrame",
  parameters: { layout: "padded" },
  loaders: [loadPreviews],
  args: { artifactId: ART.html, deferMs: 0 },
  argTypes: { artifactId: { control: "select", options: RENDERED } },
  render: ({ artifactId, deferMs }, { loaded }) => {
    const { title, html } = (loaded as Loaded).previews[artifactId]!;
    return (
      <DeferredFrame
        key={`${artifactId}-${deferMs}`}
        html={html}
        title={title}
        deferMs={deferMs}
        className="h-[560px] w-full max-w-4xl overflow-hidden rounded border border-border bg-white"
      />
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** HTML report. */
export const Html: Story = {};
/** Markdown rendered to a page. */
export const Markdown: Story = { args: { artifactId: ART.restricted } };
export const Jsx: Story = { args: { artifactId: ART.jsx } };
/** Long defer, to see the "Loading preview…" placeholder. */
export const Deferred: Story = { args: { deferMs: 60_000 } };
