import type { Meta, StoryObj } from "@storybook/react-vite";

import { DirContents } from "../../../modules/files/components/dir-contents.js";
import {
  FilesPanelContext,
  useFilesPanelController,
} from "../../../modules/files/components/files-panel-controller.js";
import { seedAgents } from "../agents/story-helpers";
import { openWorkspace } from "./file-fixtures";

/** One directory's rows (recursing into expanded folders), inside the context
 *  the real files-panel controller provides. */
function DirContentsStory(props: { path: string; depth: number }) {
  const controller = useFilesPanelController({ onOpenFile: () => {} });
  return (
    <div className="w-[280px] border-r border-border">
      <FilesPanelContext.Provider value={controller.ctxValue}>
        <DirContents {...props} />
      </FilesPanelContext.Provider>
    </div>
  );
}

const meta = {
  title: "Components/Files/DirContents",
  component: DirContents,
  loaders: [seedAgents(), openWorkspace()],
  render: (args) => <DirContentsStory {...args} />,
  args: { path: "", depth: 0 },
} satisfies Meta<typeof DirContents>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WorkspaceRoot: Story = {};

export const Subfolder: Story = {
  loaders: [openWorkspace({ expanded: ["src/pricing"] })],
  args: { path: "src/pricing", depth: 1 },
};

export const NestedExpanded: Story = {
  loaders: [openWorkspace({ expanded: ["src", "src/api"] })],
  args: { path: "src", depth: 0 },
};
