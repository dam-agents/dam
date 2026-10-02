import type { Meta, StoryObj } from "@storybook/react-vite";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const meta = {
  title: "Components/UI/Card",
  component: Card,
  parameters: { layout: "padded" },
  args: {
    className: "flex max-w-xl items-center gap-4 p-4",
    children: (
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">Ada Lovelace</p>
        <p className="text-sm text-muted-foreground">ada@example.com</p>
      </div>
    ),
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Surface: Story = {};

export const WithSections: Story = {
  render: () => (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>Providers</CardTitle>
        <CardDescription>
          Agents need an API key from a provider to reach a model.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-foreground">No provider is connected yet.</p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button>Connect provider</Button>
        <Button variant="ghost">Cancel</Button>
      </CardFooter>
    </Card>
  ),
};

export const Loading: Story = {
  args: { className: "h-[76px] max-w-xl animate-pulse", children: null },
};
