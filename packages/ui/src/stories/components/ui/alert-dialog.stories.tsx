import type { Meta, StoryObj } from "@storybook/react-vite";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

const meta = {
  title: "Components/UI/AlertDialog",
  component: AlertDialog,
  parameters: { layout: "fullscreen" },
  args: { defaultOpen: true },
  argTypes: { defaultOpen: { control: "boolean" } },
  render: (args) => (
    <div className="p-6">
      <AlertDialog {...args}>
        <AlertDialogTrigger asChild>
          <Button variant="outline">Delete folder</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete folder “Research notes”?</AlertDialogTitle>
            <AlertDialogDescription>
              Artifacts inside are kept and become ungrouped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  ),
} satisfies Meta<typeof AlertDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Closed: Story = { args: { defaultOpen: false } };
