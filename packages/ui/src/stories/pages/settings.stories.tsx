import { Add, Checkmark, TrashCan } from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import { PageShell } from "./_shell";

const meta: Meta = {
  title: "Pages/Settings",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

const tabs = [
  "Account",
  "Appearance",
  "Providers",
  "Connections",
  "Notifications",
  "Billing",
] as const;

function SettingsLayout({
  activeTab,
  children,
}: {
  activeTab: (typeof tabs)[number];
  children: React.ReactNode;
}) {
  return (
    <PageShell activeNav="settings">
      <PageHeader title="Settings" />

      <div className="flex gap-8">
        <nav className="flex w-[200px] shrink-0 flex-col gap-1">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              className={cn(
                "rounded-lg px-3 py-2 text-left text-sm transition-colors",
                tab === activeTab
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              {tab}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </PageShell>
  );
}

function FormField({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const Account: Story = {
  render: () => (
    <SettingsLayout activeTab="Account">
      <div className="flex flex-col gap-8">
        <section className="flex flex-col gap-4">
          <SectionLabel>Profile</SectionLabel>
          <Card>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-12 items-center justify-center rounded-full bg-muted text-lg font-semibold text-foreground">
                JD
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-foreground">
                  jamie.dev
                </p>
                <p className="text-sm text-muted-foreground">Signed in</p>
              </div>
              <Button variant="outline" size="sm">
                Log out
              </Button>
            </CardContent>
          </Card>
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel>Account</SectionLabel>
          <FormField label="Display name">
            <Input defaultValue="Jamie Jabbour" />
          </FormField>
          <FormField label="Email">
            <Input defaultValue="jamie@example.com" type="email" />
          </FormField>
        </section>

        <section className="flex flex-col gap-4">
          <SectionLabel>Organization</SectionLabel>
          <FormField label="Organization name">
            <Input defaultValue="Acme Corp" />
          </FormField>
          <FormField
            label="Organization slug"
            hint="Used in URLs and API paths."
          >
            <Input defaultValue="acme-corp" />
          </FormField>
        </section>

        <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
          <Button variant="outline">Cancel</Button>
          <Button>Save changes</Button>
        </div>
      </div>
    </SettingsLayout>
  ),
};

function ThemeCard({
  name,
  selected,
  desc,
}: {
  name: string;
  selected?: boolean;
  desc: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
        selected
          ? "border-primary bg-primary/10 shadow-sm"
          : "border-border bg-card hover:bg-muted/40",
      )}
    >
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted">
        {selected && <Checkmark size={16} className="text-primary" />}
      </div>
      <p className="text-sm font-semibold text-foreground">{name}</p>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </button>
  );
}

export const Appearance: Story = {
  render: () => {
    function ToggleSwitch({ initial = false }: { initial?: boolean }) {
      const [checked, setChecked] = useState(initial);
      return <Switch checked={checked} onCheckedChange={setChecked} />;
    }

    return (
      <SettingsLayout activeTab="Appearance">
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-4">
            <SectionLabel>Theme</SectionLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <ThemeCard name="Light" desc="Light background with dark text" />
              <ThemeCard
                name="Dark"
                selected
                desc="Dark background with light text"
              />
              <ThemeCard name="System" desc="Follow your system preference" />
            </div>
          </section>

          <section className="flex flex-col gap-6">
            <SectionLabel>Display</SectionLabel>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Compact mode
                </p>
                <p className="text-sm text-muted-foreground">
                  Reduce spacing in lists and tables.
                </p>
              </div>
              <ToggleSwitch />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">
                  Show agent avatars
                </p>
                <p className="text-sm text-muted-foreground">
                  Display initials badges next to agent names.
                </p>
              </div>
              <ToggleSwitch initial />
            </div>
          </section>
        </div>
      </SettingsLayout>
    );
  },
};

export const Providers: Story = {
  render: () => (
    <SettingsLayout activeTab="Providers">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <SectionLabel>API Providers</SectionLabel>
          <Button variant="outline" size="sm">
            <Add size={16} />
            Add provider
          </Button>
        </div>

        {[
          { name: "Anthropic", model: "claude-3.5-sonnet", status: "active" },
          { name: "OpenAI", model: "gpt-4o", status: "active" },
          { name: "Google", model: "gemini-2.0-flash", status: "inactive" },
        ].map((provider) => (
          <Card key={provider.name}>
            <CardContent className="flex items-center gap-4 p-4">
              <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-sm font-bold uppercase text-foreground">
                {provider.name.slice(0, 2)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {provider.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  Default model: {provider.model}
                </p>
              </div>
              <Badge
                variant={provider.status === "active" ? "success" : "muted"}
                size="sm"
              >
                {provider.status}
              </Badge>
              <button
                type="button"
                className="text-muted-foreground transition-colors hover:text-danger"
              >
                <TrashCan size={16} />
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </SettingsLayout>
  ),
};

export const ProvidersEmpty: Story = {
  name: "Providers (empty)",
  render: () => (
    <SettingsLayout activeTab="Providers">
      <div className="flex flex-col gap-6">
        <SectionLabel>API Providers</SectionLabel>

        <Callout tone="muted" variant="dashed">
          <p className="text-sm font-medium text-foreground">
            No providers configured
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add an API provider to start creating agents. You'll need an API key
            from Anthropic, OpenAI, or Google.
          </p>
          <Button variant="outline" size="sm" className="mt-3">
            <Add size={16} />
            Add provider
          </Button>
        </Callout>
      </div>
    </SettingsLayout>
  ),
};

export const Connections: Story = {
  render: () => (
    <SettingsLayout activeTab="Connections">
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <SectionLabel>Connections</SectionLabel>
          <Button variant="outline" size="sm">
            <Add size={16} />
            Add connection
          </Button>
        </div>

        {[
          { name: "GitHub", type: "OAuth App", connected: true },
          { name: "Slack", type: "Bot Token", connected: true },
          { name: "Linear", type: "API Key", connected: false },
        ].map((conn) => (
          <div
            key={conn.name}
            className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3"
          >
            <div>
              <p className="text-sm font-medium text-foreground">{conn.name}</p>
              <p className="text-xs text-muted-foreground">{conn.type}</p>
            </div>
            {conn.connected ? (
              <Badge variant="success" size="sm">
                Connected
              </Badge>
            ) : (
              <Button variant="outline" size="sm">
                Connect
              </Button>
            )}
          </div>
        ))}
      </div>
    </SettingsLayout>
  ),
};
