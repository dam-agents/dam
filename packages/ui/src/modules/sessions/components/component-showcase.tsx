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
        <Section
          title="User Message"
          description="Text sent by the user. Rendered in a bordered card, right-aligned."
        >
          <div className="flex flex-col gap-1 items-end">
            <span className="text-[11px] font-medium text-muted-foreground mb-0.5">
              You
            </span>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-5 py-3 text-[14px] text-foreground max-w-[620px]">
              <span className="whitespace-pre-wrap break-words">
                Can you refactor the auth module to use JWT instead of session
                cookies?
              </span>
            </div>
          </div>
        </Section>

        {/* Agent text */}
        <Section
          title="Agent Text"
          description="Conversational output from the agent. Rendered as markdown (sans-serif, 14px)."
        >
          <div className="flex flex-col gap-1 items-start">
            <span className="text-[11px] font-medium text-muted-foreground mb-0.5">
              Agent
            </span>
            <div className="text-[14px] text-foreground/85">
              <Markdown>
                {`I'll refactor the auth module to use JWT. Here's my plan:\n\n1. Replace the session middleware with a JWT verification middleware\n2. Update the login endpoint to issue signed tokens\n3. Add a token refresh mechanism\n\nLet me start with the middleware.`}
              </Markdown>
            </div>
          </div>
        </Section>

        {/* Agent text with markdown features */}
        <Section
          title="Agent Text — Rich Markdown"
          description="Agent output with headings, bold, inline code, code blocks, links, and lists."
        >
          <div className="text-[14px] text-foreground/85">
            <Markdown>
              {`## Summary\n\nThe issue is in \`src/routes/analytics.ts\`. The query fetches **all** events without pagination:\n\n- No \`LIMIT\`/\`OFFSET\` — loads entire dataset into memory\n- N+1 enrichment — each record triggers a separate async call\n- No index on \`(org_id, created_at)\` — full table scan\n\n\`\`\`typescript\nconst records = await db.query(\n  'SELECT * FROM events WHERE org_id = $1',\n  [req.orgId]\n);\n\`\`\`\n\n> This pattern is known to cause timeouts at scale.\n\nSee [the docs](https://example.com) for pagination best practices.`}
            </Markdown>
          </div>
        </Section>

        {/* Tool chips — all statuses */}
        <Section
          title="Tool Actions — Statuses"
          description="Tool calls shown as monospace items with a left border group. Statuses: completed, running, pending_approval, failed."
        >
          <div className="flex flex-col gap-1">
            <div className="pl-3 border-l-2 border-muted-foreground/15">
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
            </div>
            <div className="pl-3 border-l-2 border-muted-foreground/15">
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
            </div>
            <div className="pl-3 border-l-2 border-muted-foreground/15">
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
            </div>
            <div className="pl-3 border-l-2 border-muted-foreground/15">
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
            </div>
            <div className="pl-3 border-l-2 border-muted-foreground/15">
              <ToolChip
                chip={{
                  kind: "tool",
                  toolCallId: "tc-5",
                  title: "Run: mise run check",
                  status: "running",
                }}
              />
            </div>
            <div className="pl-3 border-l-2 border-muted-foreground/15">
              <ToolChip
                chip={{
                  kind: "tool",
                  toolCallId: "tc-6",
                  title:
                    "Run: psql -c 'CREATE INDEX CONCURRENTLY idx_events ON events(org_id)'",
                  status: "pending_approval",
                }}
              />
            </div>
            <div className="pl-3 border-l-2 border-muted-foreground/15">
              <ToolChip
                chip={{
                  kind: "tool",
                  toolCallId: "tc-7",
                  title:
                    "Run: curl -s https://internal-registry.corp.net/v2/manifests",
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
          </div>
        </Section>

        {/* Thought block */}
        <Section
          title="Thought Block"
          description="Agent's internal reasoning. Collapsible — auto-collapses when streaming ends."
        >
          <div className="flex flex-col gap-1">
            <div className="pl-3 border-l-2 border-muted-foreground/15">
              <ThoughtBlock
                text="The user wants to migrate from session-based auth to JWT tokens. I'll need to update the middleware, the login endpoint, and the token validation logic. Let me check the existing implementation first."
                streaming={false}
              />
            </div>
          </div>
        </Section>

        {/* Notice / separator */}
        <Section
          title="Notice (System Separator)"
          description="System messages like 'Older conversation not loaded' or pause markers. Full-width line with centered text."
        >
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
        <Section
          title="Streaming States"
          description="Cursor blink while agent is generating. 'Waiting' state when queued behind another prompt."
        >
          <div className="flex flex-col gap-4 items-start">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">
                Active streaming (cursor):
              </span>
              <span className="inline-block w-[7px] h-4 bg-primary anim-blink rounded-sm" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">
                Queued (waiting):
              </span>
              <span className="text-[12px] text-muted-foreground italic">
                Waiting for previous prompt…
              </span>
            </div>
          </div>
        </Section>

        {/* File attachment */}
        <Section
          title="File Attachment"
          description="Files attached to user messages (uploaded) or referenced by agent."
        >
          <div className="inline-flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="text-muted-foreground shrink-0"
            >
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14,2 14,8 20,8" />
            </svg>
            <span className="text-[13px] text-foreground/80">config.json</span>
            <span className="text-[11px] text-muted-foreground">2.4 KB</span>
          </div>
        </Section>

        {/* Image */}
        <Section
          title="Image"
          description="Inline images from user uploads or agent-generated content."
        >
          <div className="w-[200px] h-[120px] rounded-lg border border-border bg-muted/30 flex items-center justify-center text-[11px] text-muted-foreground">
            [image preview]
          </div>
        </Section>

        {/* Error state */}
        <Section
          title="Send Error"
          description="Shown when a user message fails to send. Includes optional retry button."
        >
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
            Failed to send message: connection timeout
            <button className="ml-3 text-[12px] font-medium underline">
              Retry
            </button>
          </div>
        </Section>

        {/* Approval bar */}
        <Section
          title="Approval Cards"
          description="Permission prompts with full action set. ext_authz (network) shows host-scoped allow + customize; ACP native (tool calls) shows allow once / permanently."
        >
          <div className="flex flex-col gap-3">
            {/* ext_authz — network egress approval */}
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex flex-col gap-2.5">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-foreground">
                  http-intake.logs.us5.datadoghq.com
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                  POST /api/v2/logs
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Allow once
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="18 6 9 17 4 12" />
                      <polyline points="24 6 15 17 10 12" />
                    </svg>
                    Allow permanently
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted min-w-0"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <span className="truncate">
                      Allow http-intake.logs.us5.datadoghq.com
                    </span>
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                    Dismiss
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                      <path d="m14.5 9.5-5 5" />
                      <path d="m9.5 9.5 5 5" />
                    </svg>
                    Deny forever
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 7h-9" />
                      <path d="M14 17H5" />
                      <circle cx="17" cy="17" r="3" />
                      <circle cx="7" cy="7" r="3" />
                    </svg>
                    Customize…
                  </button>
                </div>
              </div>
            </div>

            {/* ACP native — tool call approval */}
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 flex flex-col gap-2.5">
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-foreground">
                  api.anthropic.com
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                  POST /v1/messages
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Allow once
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="18 6 9 17 4 12" />
                      <polyline points="24 6 15 17 10 12" />
                    </svg>
                    Allow permanently
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-input bg-background text-[12px] font-medium text-foreground hover:bg-muted min-w-0"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    <span className="truncate">Allow api.anthropic.com</span>
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                    Dismiss
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-destructive/70 hover:bg-destructive/10 hover:text-destructive"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
                      <path d="m14.5 9.5-5 5" />
                      <path d="m9.5 9.5 5 5" />
                    </svg>
                    Deny forever
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 7h-9" />
                      <path d="M14 17H5" />
                      <circle cx="17" cy="17" r="3" />
                      <circle cx="7" cy="7" r="3" />
                    </svg>
                    Customize…
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
        <p className="text-[12px] text-muted-foreground mt-0.5">
          {description}
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-5">
        {children}
      </div>
    </div>
  );
}
