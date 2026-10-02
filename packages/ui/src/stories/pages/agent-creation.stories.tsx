import type { Meta, StoryObj } from "@storybook/react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Input } from "@/components/ui/input";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";

import { SetupShell } from "./_shell";

const meta: Meta = {
  title: "Pages/Agent Creation",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

function SetupPageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <header className="mb-8">
      <h1 className="text-[22px] font-semibold tracking-[-0.4px] text-foreground">
        {title}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
    </header>
  );
}

function FormSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-6">
      <SectionLabel spaced>{label}</SectionLabel>
      {children}
    </div>
  );
}

const harnesses = [
  {
    id: "claude-code",
    name: "Claude Code",
    desc: "Anthropic's coding agent harness",
  },
  { id: "codex", name: "Codex", desc: "OpenAI's coding agent" },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    desc: "Google's Gemini-powered CLI agent",
  },
  {
    id: "custom",
    name: "Custom image",
    desc: "Bring your own container image",
  },
];

function HarnessGrid({ selected }: { selected?: string }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {harnesses.map((h) => (
        <button
          key={h.id}
          type="button"
          className={`flex flex-col items-start gap-1 rounded-lg border p-4 text-left transition-colors ${
            h.id === selected
              ? "border-primary bg-primary/5 shadow-sm"
              : "border-border bg-card hover:bg-muted/40"
          }`}
        >
          <p className="text-sm font-semibold text-foreground">{h.name}</p>
          <p className="text-sm text-muted-foreground">{h.desc}</p>
        </button>
      ))}
    </div>
  );
}

export const Default: Story = {
  render: () => (
    <SetupShell>
      <SetupPageHeader
        title="Create coding agent"
        subtitle="Set up a new coding agent with a harness, provider, and optional connections."
      />

      <FormSection label="Name">
        <Input placeholder="e.g. code-review-bot" className="max-w-sm" />
      </FormSection>

      <FormSection label="Image">
        <HarnessGrid />
      </FormSection>

      <FormSection label="Provider">
        <Select className="max-w-sm">
          <option value="">Select a provider...</option>
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="ibm-litellm">IBM LiteLLM</option>
        </Select>
      </FormSection>

      <FormSection label="Connections">
        <div className="flex flex-col gap-2">
          {["GitHub", "Slack", "Linear"].map((conn) => (
            <div
              key={conn}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
            >
              <span className="text-sm text-foreground">{conn}</span>
              <Button variant="outline" size="sm">
                Connect
              </Button>
            </div>
          ))}
        </div>
      </FormSection>

      <div className="mt-8 flex items-center justify-end gap-3">
        <Button disabled>Create coding agent</Button>
      </div>
    </SetupShell>
  ),
};

export const Filled: Story = {
  render: () => (
    <SetupShell>
      <SetupPageHeader
        title="Create coding agent"
        subtitle="Set up a new coding agent with a harness, provider, and optional connections."
      />

      <FormSection label="Name">
        <Input value="code-review-bot" className="max-w-sm" readOnly />
      </FormSection>

      <FormSection label="Image">
        <HarnessGrid selected="claude-code" />
      </FormSection>

      <FormSection label="Provider">
        <div className="flex max-w-sm items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground">
          Anthropic
        </div>
      </FormSection>

      <FormSection label="Connections">
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
            <span className="text-sm text-foreground">GitHub</span>
            <span className="text-sm text-success">Connected</span>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
            <span className="text-sm text-foreground">Slack</span>
            <Button variant="outline" size="sm">
              Connect
            </Button>
          </div>
        </div>
      </FormSection>

      <div className="mt-8 flex items-center justify-end gap-3">
        <Button>Create coding agent</Button>
      </div>
    </SetupShell>
  ),
};

export const Empty: Story = {
  name: "No providers available",
  render: () => (
    <SetupShell>
      <SetupPageHeader
        title="Create coding agent"
        subtitle="Set up a new coding agent with a harness, provider, and optional connections."
      />

      <Callout tone="warning" className="mt-6">
        <p className="text-sm font-medium text-foreground">
          No API providers configured
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          You need at least one API provider before creating an agent. Go to
          Settings &rarr; Providers to add one.
        </p>
        <Button variant="outline" size="sm" className="mt-3">
          Go to settings
        </Button>
      </Callout>
    </SetupShell>
  ),
};
