import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "./button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";

const meta: Meta<typeof Card> = {
  title: "Components/Card",
  component: Card,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof Card>;

export const Default: Story = {
  render: () => (
    <Card className="w-[380px]">
      <CardHeader>
        <CardTitle>Agent configuration</CardTitle>
        <CardDescription>
          Configure your agent's runtime settings and connections.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          2 CPU / 2 Gi &middot; Claude Code harness &middot; Anthropic provider
        </p>
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline">Cancel</Button>
        <Button>Save</Button>
      </CardFooter>
    </Card>
  ),
};

export const ContentOnly: Story = {
  name: "Content only",
  render: () => (
    <Card className="w-[380px]">
      <CardContent className="p-4">
        <p className="text-sm font-medium text-foreground">ci-pipeline</p>
        <p className="mt-1 text-sm text-muted-foreground">
          12 sessions &middot; 2 CPU / 2 Gi
        </p>
      </CardContent>
    </Card>
  ),
};

export const WithHeaderAndFooter: Story = {
  name: "Full composition",
  render: () => (
    <Card className="w-[380px]">
      <CardHeader>
        <CardTitle>Monthly usage</CardTitle>
        <CardDescription>September 2026</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold text-foreground">$142.50</p>
        <p className="mt-1 text-sm text-muted-foreground">
          8 CPU &middot; 36 sessions &middot; 124 hours
        </p>
      </CardContent>
      <CardFooter>
        <Button variant="link" size="sm" className="px-0">
          View billing details
        </Button>
      </CardFooter>
    </Card>
  ),
};
