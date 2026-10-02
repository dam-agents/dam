import type { Meta, StoryObj } from "@storybook/react-vite";

import { ArtifactLinkChip } from "@/modules/artifacts/components/artifact-link-chip";

import { ART } from "./artifact-fixtures";

/** Inline chip for an artifact link in chat Markdown; fetches the artifact itself. */
const meta = {
  title: "Components/Artifacts/ArtifactLinkChip",
  component: ArtifactLinkChip,
  parameters: { layout: "padded" },
  args: { artifactId: ART.html },
} satisfies Meta<typeof ArtifactLinkChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Html: Story = {};
export const Markdown: Story = { args: { artifactId: ART.restricted } };
export const Code: Story = { args: { artifactId: ART.code } };

/** In a sentence, as it appears in an agent reply. */
export const InProse: Story = {
  render: (args) => (
    <p className="max-w-xl text-sm text-foreground">
      I published the report as <ArtifactLinkChip {...args} /> — it has the p95
      breakdown by region.
    </p>
  ),
};

/** Unknown id: falls back to the link text, with a generic icon. */
export const NotFound: Story = {
  args: { artifactId: "art-missing", children: "latency-report.html" },
};
