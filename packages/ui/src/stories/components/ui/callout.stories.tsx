import { Renew, WarningAlt } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react-vite";

import { Callout } from "@/components/ui/callout";

const TONES = [
  "default",
  "muted",
  "gradient",
  "info",
  "warning",
  "danger",
] as const;

const COPY: Record<(typeof TONES)[number], string> = {
  default: "Pick one of your connections, or add a new one.",
  muted: "Pick a starter kit to pre-fill your agent setup.",
  gradient: "Artifacts from every agent collect here.",
  info: "2 agents out of date — newer images available upstream.",
  warning:
    "This kit asks for a provider that the chosen harness cannot run on. Pick another harness, or a kit whose provider fits.",
  danger:
    "Couldn't load API keys. The server returned an error. Try again or check your network connection.",
};

const meta = {
  title: "Components/UI/Callout",
  component: Callout,
  parameters: { layout: "padded" },
  args: {
    tone: "info",
    variant: "solid",
    size: "md",
    inset: false,
    children: COPY.info,
    className: "max-w-xl text-sm",
  },
  argTypes: {
    tone: { control: "select", options: TONES },
    variant: { control: "inline-radio", options: ["solid", "dashed"] },
    size: { control: "inline-radio", options: ["sm", "md"] },
    inset: { control: "boolean" },
  },
} satisfies Meta<typeof Callout>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const AllTones: Story = {
  render: (args) => (
    <div className="flex max-w-xl flex-col gap-3">
      {TONES.map((tone) => (
        <Callout key={tone} {...args} tone={tone}>
          <span className="text-muted-foreground">{tone}: </span>
          {COPY[tone]}
        </Callout>
      ))}
    </div>
  ),
};

export const Dashed: Story = {
  args: { tone: "default", variant: "dashed", children: COPY.default },
};

export const SmallInfoBanner: Story = {
  args: {
    tone: "info",
    size: "sm",
    className: "max-w-xl",
    children: (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Renew size={16} className="shrink-0 text-accent" />
        <span>
          <strong className="font-medium text-foreground">2 agents</strong> out
          of date — newer images available upstream.
        </span>
      </p>
    ),
  },
};

export const SmallWarning: Story = {
  args: {
    tone: "warning",
    size: "sm",
    className: "flex max-w-xl flex-col gap-1 text-sm",
    children: (
      <>
        <div className="flex items-center gap-2 text-warning">
          <WarningAlt size={16} />
          <span className="font-medium">Shadowing inherited values</span>
        </div>
        <p className="text-muted-foreground">
          <span className="font-mono">GITHUB_TOKEN</span> shadows GitHub's
          contribution
        </p>
      </>
    ),
  },
};

export const Danger: Story = {
  args: { tone: "danger", children: COPY.danger },
};

export const Inset: Story = {
  args: { tone: "default", inset: true, children: COPY.default },
};
