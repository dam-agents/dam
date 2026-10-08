import { OverflowMenuVertical } from "@carbon/icons-react";
import type { ReactNode } from "react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import { stateDotClass } from "../components/status-indicator.js";
import { useAgentsList } from "../modules/agents/api/queries.js";
import { resolveAgentDisplay } from "../modules/agents/utils/agent-resolver.js";
import { useStore } from "../store.js";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-[#161616] p-4 text-[13px] leading-relaxed text-[#f4f4f4] dark:bg-[#1e1e1e]">
      <code>{children}</code>
    </pre>
  );
}

function InlineCode({ children }: { children: string }) {
  return (
    <code className="rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground">
      {children}
    </code>
  );
}

const MOCK_MESSAGES: { role: "user" | "assistant"; content: ReactNode }[] = [
  {
    role: "user",
    content:
      "Review the auth middleware changes for session token compliance. Check if the storage and rotation meet the new requirements.",
  },
  {
    role: "assistant",
    content: (
      <>
        <p>
          I&apos;ve reviewed the auth middleware in{" "}
          <InlineCode>src/middleware/auth.ts</InlineCode>. The session tokens
          are stored in HTTP-only cookies with the{" "}
          <InlineCode>Secure</InlineCode> flag, which is good. However, I found
          two compliance issues:
        </p>
        <ol className="ml-5 list-decimal space-y-1.5">
          <li>
            Token rotation is set to 24 hours — the spec requires 15 minutes
            maximum
          </li>
          <li>
            No server-side revocation check, so terminated sessions stay valid
            until expiry
          </li>
        </ol>
        <p>Here&apos;s the current verification flow:</p>
        <CodeBlock>
          {`const token = req.cookies['session-token'];
const payload = jwt.verify(token, process.env.JWT_SECRET);
// No revocation check — proceeds directly to handler`}
        </CodeBlock>
        <p>
          I&apos;d recommend adding a session store lookup before processing
          each request. Want me to implement both fixes?
        </p>
      </>
    ),
  },
  {
    role: "user",
    content:
      "Yes, implement both. Also add audit logging for all auth events — we need it for the compliance report.",
  },
  {
    role: "assistant",
    content: (
      <>
        <p>Done. I&apos;ve updated three files:</p>
        <p>
          <strong>1. Token rotation</strong> — reduced from 24h to 15 minutes:
        </p>
        <CodeBlock>{"const TOKEN_ROTATION_MS = 15 * 60 * 1000;"}</CodeBlock>
        <p>
          <strong>2. Session validation</strong> — added revocation check on
          every authenticated request:
        </p>
        <CodeBlock>
          {`async function validateSession(req, res, next) {
  const { sid } = req.tokenPayload;
  const session = await sessionStore.get(sid);

  if (!session || session.revokedAt) {
    auditLog('auth.session.rejected', { sid, reason: 'revoked' });
    return res.status(401).json({ error: 'Session expired' });
  }

  req.session = session;
  next();
}`}
        </CodeBlock>
        <p>
          <strong>3. Audit logging</strong> — all auth events now go to the{" "}
          <InlineCode>audit_events</InlineCode> table:
        </p>
        <ul className="ml-5 list-disc space-y-1">
          <li>
            <InlineCode>auth.login</InlineCode> — successful authentication
          </li>
          <li>
            <InlineCode>auth.logout</InlineCode> — explicit sign out
          </li>
          <li>
            <InlineCode>auth.token.rotated</InlineCode> — automatic refresh
          </li>
          <li>
            <InlineCode>auth.session.rejected</InlineCode> — failed validation
          </li>
        </ul>
        <p>
          All 47 tests passing. The changes touch{" "}
          <InlineCode>src/middleware/auth.ts</InlineCode>, a new{" "}
          <InlineCode>src/middleware/audit.ts</InlineCode>, and{" "}
          <InlineCode>src/config/auth.ts</InlineCode>. Ready for review.
        </p>
      </>
    ),
  },
];

export function MockChatView() {
  const selectedAgent = useStore((s) => s.selectedAgent);
  const agents = useAgentsList();
  const restartingAgents = useStore((s) => s.restartingAgents);
  const restartingIds = useMemo(
    () => new Set(restartingAgents.keys()),
    [restartingAgents],
  );

  const agent = agents.find((a) => a.id === selectedAgent);
  const display = agent ? resolveAgentDisplay(agent, restartingIds) : null;
  const dotColor = display
    ? stateDotClass[display.state]
    : "bg-muted-foreground";

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="shrink-0 border-b border-border p-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className={cn("size-2 shrink-0 rounded-full", dotColor)} />
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
            {agent?.name ?? "Agent"}
          </h1>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon-xs">
                <OverflowMenuVertical size={16} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>Configure agent</DropdownMenuItem>
              <DropdownMenuItem>Restart</DropdownMenuItem>
              <DropdownMenuItem className="text-destructive focus:text-destructive">
                Delete Agent
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[813px] flex-col gap-8 px-4 py-8 md:px-8">
          {MOCK_MESSAGES.map((msg, i) =>
            msg.role === "user" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl border border-border px-4 py-3 text-sm leading-relaxed text-foreground">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div
                key={i}
                className="flex w-full flex-col gap-3 text-sm leading-relaxed text-foreground [&_p]:my-0"
              >
                {msg.content}
              </div>
            ),
          )}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 md:px-8">
        <div className="mx-auto w-full max-w-[813px]">
          <div className="flex min-h-[52px] items-center rounded-2xl border border-border bg-card px-4 py-3">
            <span className="flex-1 text-sm text-muted-foreground">
              Send a message…
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
            <span>Claude Sonnet 4</span>
            <span className="text-border">·</span>
            <span>No schedules</span>
          </div>
        </div>
      </div>
    </div>
  );
}
