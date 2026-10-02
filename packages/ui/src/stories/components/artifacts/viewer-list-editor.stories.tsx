import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";

import { ViewerListEditor } from "@/modules/artifacts/components/viewer-list-editor";

import { ART, getArtifact } from "./artifact-fixtures";

type Args = { disabled: boolean; initialDraft: string; empty: boolean };

const loadViewers = async () => ({
  viewers: (await getArtifact(ART.restricted)).viewers,
});
type Loaded = Awaited<ReturnType<typeof loadViewers>>;

/** Email allowlist for restricted sharing (inside ShareDialog). */
const meta = {
  title: "Components/Artifacts/ViewerListEditor",
  parameters: { layout: "padded" },
  loaders: [loadViewers],
  args: { disabled: false, initialDraft: "", empty: false },
  render: function Render({ disabled, initialDraft, empty }, { loaded }) {
    const [viewers, setViewers] = useState(
      empty ? [] : (loaded as Loaded).viewers,
    );
    const [draft, setDraft] = useState(initialDraft);
    return (
      <div className="max-w-md">
        <ViewerListEditor
          viewers={viewers}
          onChange={setViewers}
          disabled={disabled}
          draft={draft}
          onDraftChange={setDraft}
        />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The fixture's two viewers. */
export const WithViewers: Story = {};
export const Empty: Story = { args: { empty: true } };
/** An email typed but not yet added. */
export const WithDraft: Story = { args: { initialDraft: "sam@example.com" } };
export const Disabled: Story = { args: { disabled: true } };
