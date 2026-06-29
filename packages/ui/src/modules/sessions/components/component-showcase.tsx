import { X } from "lucide-react";

import { Markdown } from "../../../components/markdown.js";
import { ThoughtBlock } from "./thought-block.js";
import { ToolChip } from "./tool-chip.js";

export function ComponentShowcase({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-white overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b border-border bg-white">
        <h1 className="text-[16px] font-semibold text-foreground">
          Chat Component Reference
        </h1>
        <button
          onClick={onClose}
          className="h-8 w-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      <div className="max-w-[720px] mx-auto px-6 py-8 flex flex-col gap-10">
        {/* User message */}
        <Section title="User Message" description="Text sent by the user. Rendered in a bordered card, right-aligned.">
          <div className="flex flex-col gap-1 items-end">
            <span className="text-[11px] font-medium text-muted-foreground mb-0.5">You</span>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-5 py-3 text-[14px] text-foreground max-w-[620px]">
              <span className="whitespace-pre-wrap break-words">
                Can you refactor the auth module to use JWT instead of session cookies?
              </span>
            </div>
          </div>
        </Section>

        {/* Agent text */}
        <Section title="Agent Text" description="Conversational output from the agent. Rendered as markdown (sans-serif, 14px).">
          <div className="flex flex-col gap-1 items-start">
            <span className="text-[11px] font-medium text-muted-foreground mb-0.5">Agent</span>
            <div className="text-[14px] text-foreground/85">
              <Markdown>
                {`I'll refactor the auth module to use JWT. Here's my plan:\n\n1. Replace the session middleware with a JWT verification middleware\n2. Update the login endpoint to issue signed tokens\n3. Add a token refresh mechanism\n\nLet me start with the middleware.`}
              </Markdown>
            </div>
          </div>
        </Section>

        {/* Agent text with markdown features */}
        <Section title="Agent Text — Rich Markdown" description="Agent output with headings, bold, inline code, code blocks, links, and lists.">
          <div className="text-[14px] text-foreground/85">
            <Markdown>
              {`## Summary\n\nThe issue is in \`src/routes/analytics.ts\`. The query fetches **all** events without pagination:\n\n- No \`LIMIT\`/\`OFFSET\` — loads entire dataset into memory\n- N+1 enrichment — each record triggers a separate async call\n- No index on \`(org_id, created_at)\` — full table scan\n\n\`\`\`typescript\nconst records = await db.query(\n  'SELECT * FROM events WHERE org_id = $1',\n  [req.orgId]\n);\n\`\`\`\n\n> This pattern is known to cause timeouts at scale.\n\nSee [the docs](https://example.com) for pagination best practices.`}
            </Markdown>
          </div>
        </Section>

        {/* Tool chips — all statuses */}
        <Section title="Tool Actions — Statuses" description="Tool calls shown as monospace items with a left border group. Statuses: completed, running, pending_approval, failed.">
          <div className="flex flex-col gap-0.5 pl-3 border-l border-muted-foreground/15">
            <ToolChip
              chip={{
                kind: "tool",
                toolCallId: "tc-1",
                title: "Read src/middleware/auth.ts",
                status: "completed",
                content: [
                  {
                    type: "content",
                    text: "import jwt from 'jsonwebtoken';\n\nexport function authMiddleware(req, res, next) {\n  const token = req.headers.authorization?.split(' ')[1];\n  if (!token) return res.status(401).json({ error: 'Unauthorized' });\n  next();\n}",
                  },
                ],
              }}
            />
            <ToolChip
              chip={{
                kind: "tool",
                toolCallId: "tc-2",
                title: "Edit src/middleware/auth.ts",
                status: "completed",
                content: [
                  {
                    type: "diff",
                    text: "- import session from 'express-session';\n+ import jwt from 'jsonwebtoken';",
                  },
                ],
              }}
            />
            <ToolChip
              chip={{
                kind: "tool",
                toolCallId: "tc-3",
                title: "Write src/middleware/refresh.ts",
                status: "completed",
                content: [
                  {
                    type: "content",
                    text: "export function refreshHandler(req, res) {\n  // refresh token logic\n}",
                  },
                ],
              }}
            />
            <ToolChip
              chip={{
                kind: "tool",
                toolCallId: "tc-4",
                title: "Run: vitest run src/auth.test.ts",
                status: "completed",
                content: [
                  {
                    type: "terminal",
                    text: " ✓ auth.test.ts (3 tests)\n   ✓ verifies valid JWT\n   ✓ rejects expired token\n   ✓ rejects missing token\n\n Tests  3 passed (3)\n Duration  0.8s",
                  },
                ],
              }}
            />
            <ToolChip
              chip={{
                kind: "tool",
                toolCallId: "tc-5",
                title: "Run: mise run check",
                status: "running",
              }}
            />
            <ToolChip
              chip={{
                kind: "tool",
                toolCallId: "tc-6",
                title: "Run: psql -c 'CREATE INDEX CONCURRENTLY idx_events ON events(org_id)'",
                status: "pending_approval",
              }}
            />
            <ToolChip
              chip={{
                kind: "tool",
                toolCallId: "tc-7",
                title: "Run: curl -s https://internal-registry.corp.net/v2/manifests",
                status: "failed",
                content: [
                  {
                    type: "terminal",
                    text: "curl: (7) Failed to connect to internal-registry.corp.net port 443: Connection refused\n\nNetwork policy denied: host not in allowlist",
                  },
                ],
              }}
            />
          </div>
        </Section>

        {/* Thought block */}
        <Section title="Thought Block" description="Agent's internal reasoning. Collapsible — auto-collapses when streaming ends.">
          <div className="flex flex-col gap-0.5 pl-3 border-l border-muted-foreground/15">
            <ThoughtBlock
              text="The user wants to migrate from session-based auth to JWT tokens. I'll need to update the middleware, the login endpoint, and the token validation logic. Let me check the existing implementation first."
              streaming={false}
            />
          </div>
        </Section>

        {/* Notice / separator */}
        <Section title="Notice (System Separator)" description="System messages like 'Older conversation not loaded' or pause markers. Full-width line with centered text.">
          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              Older conversation not loaded
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-muted-foreground whitespace-nowrap">
              Session paused — agent reached checkpoint
            </span>
            <div className="flex-1 h-px bg-border" />
          </div>
        </Section>

        {/* Streaming states */}
        <Section title="Streaming States" description="Cursor blink while agent is generating. 'Waiting' state when queued behind another prompt.">
          <div className="flex flex-col gap-4 items-start">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Active streaming (cursor):</span>
              <span className="inline-block w-[7px] h-4 bg-primary anim-blink rounded-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">Queued (waiting):</span>
              <span className="text-[12px] text-muted-foreground italic">
                Waiting for previous prompt…
              </span>
            </div>
          </div>
        </Section>

        {/* File attachment */}
        <Section title="File Attachment" description="Files attached to user messages (uploaded) or referenced by agent.">
          <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
            </svg>
            <span className="text-[13px] text-foreground/80">config.json</span>
            <span className="text-[11px] text-muted-foreground">2.4 KB</span>
          </div>
        </Section>

        {/* Image */}
        <Section title="Image" description="Inline images from user uploads or agent-generated content.">
          <div className="w-[200px] h-[120px] rounded-lg border border-border bg-muted/30 flex items-center justify-center text-[11px] text-muted-foreground">
            [image preview]
          </div>
        </Section>

        {/* Error state */}
        <Section title="Send Error" description="Shown when a user message fails to send. Includes optional retry button.">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
            Failed to send message: connection timeout
            <button className="ml-3 text-[12px] font-medium underline">Retry</button>
          </div>
        </Section>

        {/* Approval bar */}
        <Section title="Approval Bars" description="Inline permission prompts. ACP native (tool calls) and ext_authz (network egress). Same width as chat input.">
          <div className="flex flex-col gap-1.5">
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-[#0f62fe] shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-primary shrink-0">
                  Bash
                </span>
                <code className="text-[11px] font-mono text-foreground/80 truncate flex-1 min-w-0">
                  rm -rf node_modules &amp;&amp; npm install
                </code>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium">
                    Allow once
                  </button>
                  <button className="h-6 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground">
                    Always allow
                  </button>
                  <button className="h-6 px-2 rounded-md text-[11px] font-medium text-destructive/70">
                    Reject
                  </button>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full bg-[#0f62fe] shrink-0" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground shrink-0">
                  GET
                </span>
                <code className="text-[11px] font-mono text-foreground/80 truncate flex-1 min-w-0">
                  registry.npmjs.org/express/latest
                </code>
                <div className="flex items-center gap-1 shrink-0">
                  <button className="h-6 px-2 rounded-md bg-primary text-primary-foreground text-[11px] font-medium">
                    Allow
                  </button>
                  <button className="h-6 px-2 rounded-md border border-border text-[11px] font-medium text-muted-foreground">
                    Always
                  </button>
                  <button className="h-6 px-2 rounded-md text-[11px] font-medium text-destructive/70">
                    Deny
                  </button>
                </div>
              </div>
            </div>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-[14px] font-semibold text-foreground">{title}</h2>
        <p className="text-[12px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5">{children}</div>
    </div>
  );
}
