import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";

import { DockedArtifactPanel } from "@/modules/artifacts/components/docked-artifact-panel";
import { useStore } from "@/store";

import { IDS } from "../../backend/scenario";
import { ART } from "./artifact-fixtures";

type Args = { openArtifactId: string; edit: boolean };

/**
 * The artifact panel docked beside a chat. The open artifact lives in the
 * store (`openArtifactId`); the panel fetches everything else itself.
 */
const meta = {
  title: "Components/Artifacts/DockedArtifactPanel",
  args: { openArtifactId: ART.html, edit: false },
  argTypes: {
    openArtifactId: { control: "select", options: Object.values(ART) },
  },
  render: ({ openArtifactId, edit }) => {
    useStore.setState({
      openArtifactId,
      openArtifactEdit: edit,
    });
    return (
      <div className="ml-auto h-screen w-[640px] border-l border-border bg-card">
        <DockedArtifactPanel
          key={`${openArtifactId}-${edit}`}
          agentId={IDS.codingAgent}
          onSendPrompt={fn(async () => {})}
        />
      </div>
    );
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Public HTML with version switcher and copy link. */
export const RenderedHtml: Story = {};
/** Restricted Markdown. */
export const Markdown: Story = { args: { openArtifactId: ART.restricted } };
/** Code: source view. */
export const Code: Story = { args: { openArtifactId: ART.code } };
/** Opened in edit mode. */
export const Editing: Story = {
  args: { openArtifactId: ART.code, edit: true },
};
/** Id the backend doesn't know: the load-error state with Retry. */
export const NotFound: Story = { args: { openArtifactId: "art-deleted" } };
