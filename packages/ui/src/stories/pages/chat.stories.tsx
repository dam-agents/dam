import {
  ChevronDown,
  Document,
  Folders,
  OverflowMenuVertical,
  SendFilled,
  StopOutline,
} from "@carbon/icons-react";
import type { Meta, StoryObj } from "@storybook/react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";
import { Spinner } from "@/components/ui/spinner";

import { ChatShell } from "./_shell";

const meta: Meta = {
  title: "Pages/Chat",
  parameters: { layout: "fullscreen" },
};

export default meta;
type Story = StoryObj;

const mockSessions = [
  { title: "Fix login redirect loop", time: "2m", active: true, running: true },
  { title: "Review PR #482 auth changes", time: "25m", running: true },
  { title: "Investigate flaky test suite", time: "1h", unread: true },
  { title: "Update auth middleware", time: "3h" },
  { title: "Refactor user model", time: "1d" },
];

function SessionsSidebar() {
  return (
    <div className="flex h-full w-[220px] shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="inline-block size-2 rounded-full bg-success" />
        <span className="truncate text-sm font-medium text-foreground">
          ci-pipeline
        </span>
        <button
          type="button"
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <OverflowMenuVertical size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="px-3 pt-3 pb-2">
          <SectionLabel>Sessions</SectionLabel>
        </div>
        <div className="flex flex-col gap-px px-1 pb-2">
          {mockSessions.map((s) => (
            <button
              key={s.title}
              type="button"
              className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted ${
                s.active ? "bg-muted" : ""
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className="min-w-0 truncate text-sm text-foreground">
                  {s.title}
                </span>
                {s.running && (
                  <span className="working-dots ml-auto shrink-0 inline-flex items-center -space-x-[1px]">
                    <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                    <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                    <span className="size-2 rounded-full border-[1.5px] border-background bg-[#a2a9b0] dark:bg-white/40" />
                  </span>
                )}
                {s.unread && !s.running && (
                  <span className="ml-auto size-2 shrink-0 rounded-full bg-accent" />
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                {s.time} ago
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60"
        >
          <Document size={16} />
          <span>Files</span>
          <ChevronDown size={16} className="ml-auto" />
        </button>
        <button
          type="button"
          className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:bg-muted/60"
        >
          <Folders size={16} />
          <span>Artifacts</span>
          <ChevronDown size={16} className="ml-auto" />
        </button>
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
        {text}
      </div>
    </div>
  );
}

function AssistantMessage({ children }: { children: React.ReactNode }) {
  return <div className="max-w-[90%] text-sm text-foreground">{children}</div>;
}

function ToolChip({ name }: { name: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
      <span className="size-1.5 rounded-full bg-success" />
      {name}
    </div>
  );
}

function ThoughtBlock({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-2">
      <p className="text-xs italic text-muted-foreground">{text}</p>
    </div>
  );
}

function ChatInput({ disabled }: { disabled?: boolean }) {
  return (
    <div className="shrink-0 border-t border-border bg-card px-4 py-3">
      <div className="mx-auto flex max-w-[720px] items-end gap-2">
        <div className="flex flex-1 items-end rounded-xl border border-input bg-background px-4 py-3">
          <span className="flex-1 text-sm text-placeholder">
            {disabled ? "Session ended" : "Send a message..."}
          </span>
        </div>
        <Button
          size="icon"
          className="size-10 shrink-0 rounded-xl"
          disabled={disabled}
        >
          <SendFilled size={16} />
        </Button>
      </div>
      <div className="mx-auto mt-2 flex max-w-[720px] items-center gap-3">
        <Badge variant="muted">claude-3.5-sonnet</Badge>
        <span className="text-sm text-muted-foreground">&middot;</span>
        <span className="text-sm text-muted-foreground">No schedule</span>
      </div>
    </div>
  );
}

export const ActiveConversation: Story = {
  render: () => (
    <ChatShell>
      <div className="flex flex-1 min-h-0">
        <SessionsSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8">
            <div className="mx-auto flex max-w-[720px] flex-col gap-8">
              <UserMessage text="Fix the login redirect loop. When a user logs in with SSO, they get stuck in an infinite redirect between /auth/callback and /login." />

              <AssistantMessage>
                I'll investigate the login redirect loop. Let me start by
                looking at the auth callback handler and the login route.
              </AssistantMessage>

              <div className="flex flex-col gap-2">
                <ThoughtBlock text="Looking at the auth flow: /login redirects to SSO, SSO redirects back to /auth/callback, which should set the session cookie and redirect to /dashboard. The issue is likely the session cookie not being set correctly." />
                <div className="flex flex-wrap gap-2">
                  <ToolChip name="Read src/auth/callback.ts" />
                  <ToolChip name="Read src/middleware/auth.ts" />
                  <ToolChip name="Read src/routes/login.ts" />
                </div>
              </div>

              <AssistantMessage>
                Found the issue. The auth middleware checks for a valid session
                cookie, but the callback handler sets it with{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
                  SameSite=Strict
                </code>
                , which prevents the cookie from being sent on the redirect from
                the SSO provider. Changing to{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
                  SameSite=Lax
                </code>{" "}
                will fix this.
              </AssistantMessage>

              <div className="flex flex-wrap gap-2">
                <ToolChip name="Edit src/auth/callback.ts" />
              </div>

              <AssistantMessage>
                I've updated the cookie SameSite attribute from{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
                  Strict
                </code>{" "}
                to{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
                  Lax
                </code>
                . This allows the cookie to be sent on top-level navigations
                from the SSO provider while still protecting against CSRF.
              </AssistantMessage>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner size={14} />
                Agent is working...
              </div>
            </div>
          </div>
          <ChatInput />
        </div>
      </div>
    </ChatShell>
  ),
};

export const EmptySession: Story = {
  render: () => (
    <ChatShell>
      <div className="flex flex-1 min-h-0">
        <SessionsSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <div className="flex flex-1 items-center justify-center px-4">
            <div className="flex flex-col items-center gap-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-muted text-lg font-semibold text-foreground">
                CI
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  ci-pipeline
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Start a new session by sending a message.
                </p>
              </div>
            </div>
          </div>
          <ChatInput />
        </div>
      </div>
    </ChatShell>
  ),
};

export const StreamingResponse: Story = {
  render: () => (
    <ChatShell>
      <div className="flex flex-1 min-h-0">
        <SessionsSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8">
            <div className="mx-auto flex max-w-[720px] flex-col gap-8">
              <UserMessage text="Generate API documentation for the /agents endpoint." />

              <AssistantMessage>
                <p>
                  I'll analyze the endpoint handlers and generate documentation.
                  Here's what I've found so far:
                </p>
                <p className="mt-3 font-medium">
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-sm">
                    GET /api/agents
                  </code>
                </p>
                <p className="mt-1 text-muted-foreground">
                  Returns a paginated list of agents for the authenticated
                  org&nbsp;
                </p>
                <span className="inline-block h-4 w-0.5 animate-pulse bg-foreground" />
              </AssistantMessage>
            </div>
          </div>

          <div className="shrink-0 border-t border-border bg-card px-4 py-3">
            <div className="mx-auto flex max-w-[720px] items-end gap-2">
              <div className="flex flex-1 items-end rounded-xl border border-input bg-background px-4 py-3">
                <span className="flex-1 text-sm text-placeholder">
                  Agent is responding...
                </span>
              </div>
              <Button
                size="icon"
                variant="destructive"
                className="size-10 shrink-0 rounded-xl"
              >
                <StopOutline size={16} />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </ChatShell>
  ),
};

export const SessionError: Story = {
  render: () => (
    <ChatShell>
      <div className="flex flex-1 min-h-0">
        <SessionsSidebar />
        <div className="flex flex-1 flex-col min-w-0">
          <div className="flex-1 overflow-y-auto px-4 py-8 md:px-8">
            <div className="mx-auto flex max-w-[720px] flex-col gap-8">
              <UserMessage text="Triage the open bugs from this week." />

              <Callout tone="danger">
                <p className="text-sm font-medium text-foreground">
                  Session failed
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  The agent sandbox exited with code 137 (out of memory). Try
                  increasing the compute allocation or reducing the workload.
                </p>
                <Button variant="outline" size="sm" className="mt-3">
                  Retry session
                </Button>
              </Callout>
            </div>
          </div>
          <ChatInput disabled />
        </div>
      </div>
    </ChatShell>
  ),
};
