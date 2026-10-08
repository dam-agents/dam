import {
  Activity,
  Add,
  OverflowMenuVertical,
  Play,
  Save,
  Stop,
  Time,
  TrashCan,
} from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SectionLabel } from "@/components/ui/section-label";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

import { PageShell } from "./_shell";

const meta: Meta = {
  title: "Pages/Configure Agent",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

const configureTabs = [
  { value: "overview", label: "Overview" },
  { value: "settings", label: "Settings" },
  { value: "schedules", label: "Schedules" },
  { value: "connections", label: "Connections" },
] as const;

function AgentHeader({ status = "running" }: { status?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="size-2 rounded-full bg-green-700 dark:bg-success" />
        <h1 className="text-2xl font-semibold tracking-[-0.65px] text-foreground">
          ci-pipeline
        </h1>
        <Badge variant="success">{status}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm">
          <Stop size={16} /> Stop
        </Button>
        <Button variant="outline" size="sm">
          <Play size={16} /> Restart
        </Button>
        <Button variant="ghost" size="icon-xs">
          <OverflowMenuVertical size={16} />
        </Button>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
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

function ScheduleRow({
  name,
  cadence,
  enabled,
}: {
  name: string;
  cadence: string;
  enabled: boolean;
}) {
  const [on, setOn] = useState(enabled);
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-foreground">{name}</p>
          {!on && <Badge variant="muted">Paused</Badge>}
        </div>
        <div className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
          <Time size={14} /> {cadence}
        </div>
      </div>
      <Button variant="outline" size="sm">
        View results
      </Button>
      <Switch checked={on} onCheckedChange={setOn} />
      <Button variant="ghost" size="icon-xs">
        <OverflowMenuVertical size={16} />
      </Button>
    </div>
  );
}

export const Overview: Story = {
  render: () => (
    <PageShell>
      <AgentHeader />

      <div className="mt-6">
        <Tabs
          tabs={configureTabs}
          value="overview"
          onValueChange={() => {}}
          variant="underline"
          ariaLabel="Agent configuration"
        />

        <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
          <Card>
            <CardContent className="p-4">
              <SectionLabel spaced>Configuration</SectionLabel>
              <div className="divide-y divide-border">
                <InfoRow label="Image" value="Claude Code (latest)" />
                <InfoRow label="Provider" value="Anthropic" />
                <InfoRow label="CPU / Memory" value="2 CPU / 2 Gi" />
                <InfoRow label="Created" value="Sep 15, 2026" />
                <InfoRow label="Sessions" value="47 total" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <SectionLabel spaced>Recent activity</SectionLabel>
              <div className="flex flex-col gap-3">
                {[
                  { title: "Fix login redirect loop", time: "Running · 12m" },
                  { title: "Review PR #482", time: "Completed · 25m ago" },
                  {
                    title: "Investigate flaky tests",
                    time: "Completed · 1h ago",
                  },
                ].map((s) => (
                  <div key={s.title} className="flex items-center gap-3">
                    <Activity
                      size={14}
                      className="shrink-0 text-muted-foreground"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">
                        {s.title}
                      </p>
                      <p className="text-xs text-muted-foreground">{s.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageShell>
  ),
};

export const SettingsTab: Story = {
  render: () => {
    function ToggleSwitch({ initial = false }: { initial?: boolean }) {
      const [on, setOn] = useState(initial);
      return <Switch checked={on} onCheckedChange={setOn} />;
    }

    return (
      <PageShell>
        <AgentHeader />
        <div className="mt-6">
          <Tabs
            tabs={configureTabs}
            value="settings"
            onValueChange={() => {}}
            variant="underline"
            ariaLabel="Agent configuration"
          />

          <div className="mt-6 flex flex-col gap-8">
            <section className="flex flex-col gap-4">
              <SectionLabel>General</SectionLabel>
              <FormField label="Name">
                <Input defaultValue="ci-pipeline" />
              </FormField>
              <FormField label="Description">
                <Textarea defaultValue="Runs the full CI pipeline including tests, linting, and coverage reports on every push to main." />
              </FormField>
            </section>

            <section className="flex flex-col gap-4">
              <SectionLabel>Runtime</SectionLabel>
              <FormField label="Harness">
                <Select defaultValue="claude-code" className="max-w-sm">
                  <option value="claude-code">Claude Code</option>
                  <option value="codex">Codex</option>
                  <option value="gemini-cli">Gemini CLI</option>
                </Select>
              </FormField>
              <FormField
                label="Compute"
                hint="CPU and memory allocated. Uses 1:1 CPU to GiB ratio."
              >
                <Select defaultValue="2" className="max-w-sm">
                  <option value="2">2 CPU / 2 Gi</option>
                  <option value="4">4 CPU / 4 Gi</option>
                  <option value="8">8 CPU / 8 Gi</option>
                </Select>
              </FormField>
            </section>

            <section className="flex flex-col gap-6">
              <SectionLabel>Behavior</SectionLabel>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Auto-hibernate
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Pause the agent after 30 minutes of inactivity
                  </p>
                </div>
                <ToggleSwitch initial />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Always on
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Keep the agent running regardless of activity
                  </p>
                </div>
                <ToggleSwitch />
              </div>
            </section>

            <section className="flex flex-col gap-4 border-t border-border pt-8">
              <SectionLabel>Danger zone</SectionLabel>
              <Callout tone="danger">
                <p className="text-sm font-medium text-foreground">
                  Delete this agent
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Permanently delete this agent and all its sessions. This
                  action cannot be undone.
                </p>
                <Button variant="destructive" size="sm" className="mt-3">
                  <TrashCan size={16} />
                  Delete agent
                </Button>
              </Callout>
            </section>

            <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
              <Button variant="outline">Cancel</Button>
              <Button>
                <Save size={16} />
                Save changes
              </Button>
            </div>
          </div>
        </div>
      </PageShell>
    );
  },
};

export const SchedulesTab: Story = {
  render: () => (
    <PageShell>
      <AgentHeader />
      <div className="mt-6">
        <Tabs
          tabs={configureTabs}
          value="schedules"
          onValueChange={() => {}}
          variant="underline"
          ariaLabel="Agent configuration"
        />

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <SectionLabel>Schedules</SectionLabel>
            <Button size="sm">
              <Add size={16} /> Create schedule
            </Button>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            <ScheduleRow
              name="Daily standup digest"
              cadence="Every day at 9:00 AM"
              enabled
            />
            <ScheduleRow
              name="Weekly dependency audit"
              cadence="Every Monday at 6:00 AM"
              enabled
            />
            <ScheduleRow
              name="Nightly regression test"
              cadence="Every day at 2:00 AM"
              enabled={false}
            />
          </div>
        </div>
      </div>
    </PageShell>
  ),
};

export const ConnectionsTab: Story = {
  render: () => (
    <PageShell>
      <AgentHeader />
      <div className="mt-6">
        <Tabs
          tabs={configureTabs}
          value="connections"
          onValueChange={() => {}}
          variant="underline"
          ariaLabel="Agent configuration"
        />

        <div className="mt-6">
          <div className="flex items-center justify-between">
            <SectionLabel>Connections</SectionLabel>
            <Button variant="outline" size="sm">
              <Add size={16} /> Add
            </Button>
          </div>
          <div className="mt-4 flex flex-col gap-3">
            {[
              {
                name: "acme/monorepo",
                type: "Git repository",
                connected: true,
              },
              { name: "#ci-alerts", type: "Slack channel", connected: true },
              { name: "Linear", type: "API Key", connected: false },
            ].map((conn) => (
              <Card key={conn.name}>
                <CardContent className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {conn.name}
                    </p>
                    <p className="text-sm text-muted-foreground">{conn.type}</p>
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
        </div>
      </div>
    </PageShell>
  ),
};

export const Empty: Story = {
  name: "New agent (unconfigured)",
  render: () => (
    <PageShell>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-[-0.65px] text-foreground">
            my-new-agent
          </h1>
          <Badge variant="muted">not started</Badge>
        </div>
      </div>

      <Callout tone="warning" className="mt-6">
        <p className="text-sm font-medium text-foreground">
          Configuration incomplete
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          This agent needs a harness, provider, and at least one connection
          before it can run. Fill in the required fields below.
        </p>
      </Callout>

      <div className="mt-6">
        <Tabs
          tabs={configureTabs}
          value="settings"
          onValueChange={() => {}}
          variant="underline"
          ariaLabel="Agent configuration"
        />

        <div className="mt-6 flex flex-col gap-8">
          <section className="flex flex-col gap-4">
            <SectionLabel>General</SectionLabel>
            <FormField label="Name">
              <Input defaultValue="my-new-agent" />
            </FormField>
            <FormField label="Description">
              <Textarea placeholder="What does this agent do?" />
            </FormField>
          </section>

          <section className="flex flex-col gap-4">
            <SectionLabel>Runtime</SectionLabel>
            <FormField label="Harness">
              <Select className="max-w-sm">
                <option value="">Select a harness...</option>
                <option value="claude-code">Claude Code</option>
                <option value="codex">Codex</option>
                <option value="gemini-cli">Gemini CLI</option>
              </Select>
            </FormField>
            <FormField label="Compute">
              <Select defaultValue="2" className="max-w-sm">
                <option value="2">2 CPU / 2 Gi</option>
                <option value="4">4 CPU / 4 Gi</option>
                <option value="8">8 CPU / 8 Gi</option>
              </Select>
            </FormField>
          </section>

          <div className="flex items-center justify-end gap-3 border-t border-border pt-6">
            <Button variant="outline">Cancel</Button>
            <Button>
              <Save size={16} />
              Save configuration
            </Button>
          </div>
        </div>
      </div>
    </PageShell>
  ),
};
