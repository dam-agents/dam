import type { Message } from "../../../types.js";
import { msg } from "./helpers.js";
import type { TranscriptMeta } from "./types.js";

export interface ChangeCardAttachment {
  afterMessageId: string;
  files: {
    path: string;
    status: "modified" | "added" | "deleted" | "renamed";
    additions: number;
    deletions: number;
  }[];
  repo: string;
  branch: string;
  prNumber?: number;
  prUrl?: string;
}

export const TOOLS_DEMO_CHANGE_CARDS: ChangeCardAttachment[] = [
  {
    afterMessageId: "td-m4",
    files: [
      {
        path: "src/middleware/auth.ts",
        status: "modified",
        additions: 45,
        deletions: 12,
      },
      {
        path: "src/middleware/redirect.ts",
        status: "added",
        additions: 38,
        deletions: 0,
      },
      {
        path: "src/routes/auth.ts",
        status: "modified",
        additions: 28,
        deletions: 6,
      },
    ],
    repo: "acme/web-app",
    branch: "fix/auth-redirect",
  },
  {
    afterMessageId: "td-m8",
    files: [
      {
        path: "tests/middleware/auth.test.ts",
        status: "modified",
        additions: 9,
        deletions: 0,
      },
    ],
    repo: "acme/web-app",
    branch: "fix/auth-redirect",
    prNumber: 847,
    prUrl: "https://github.com/acme/web-app/pull/847",
  },
];

export function toolsDemoTranscript(): TranscriptMeta {
  const messages: Message[] = [
    msg("td-m1", "user", [
      {
        kind: "text",
        text: "The auth redirect is broken — when a token expires the user gets dumped to /login with no way back. Can you fix the redirect to include the original URL and reason?",
      },
    ]),
    msg("td-m2", "assistant", [
      {
        kind: "thought",
        text: "Read the auth middleware to understand the current redirect logic and cookie handling.",
      },
      {
        kind: "tool",
        toolCallId: "td-t1",
        title: "Read src/middleware/auth.ts",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "td-t2",
        title: "Read src/routes/auth.ts",
        status: "completed",
      },
      {
        kind: "text",
        text: "I see the problem. The middleware does a bare `redirect('/login')` with no query params, so the login page has no idea where the user came from or why they were kicked out.\n\nHere's my plan:\n1. Create a `redirectToLogin` helper that preserves the original path and adds a `reason` param\n2. Update the middleware to use it for all three failure cases (missing, expired, invalid)\n3. Update the login route to pass `from` back on successful auth\n\nI'll keep the change small — three files.",
      },
    ]),
    msg("td-m3", "user", [{ kind: "text", text: "Go ahead." }]),
    msg("td-m4", "assistant", [
      {
        kind: "tool",
        toolCallId: "td-t3",
        title: "Edit src/middleware/auth.ts",
        status: "completed",
        content: [
          {
            type: "diff",
            text: "- if (!token) return NextResponse.redirect('/login');\n+ if (!token) {\n+   return redirectToLogin(req, { reason: 'missing-token' });\n+ }",
          },
        ],
      },
      {
        kind: "tool",
        toolCallId: "td-t4",
        title: "Create src/middleware/redirect.ts",
        status: "completed",
        content: [
          {
            type: "diff",
            text: "+ export function redirectToLogin(\n+   req: NextRequest,\n+   opts: { reason: RedirectReason },\n+ ) { ... }",
          },
        ],
      },
      {
        kind: "tool",
        toolCallId: "td-t5",
        title: "Edit src/routes/auth.ts",
        status: "completed",
        content: [
          {
            type: "diff",
            text: "- res.cookie('session', token);\n- return res.json({ ok: true });\n+ res.cookie('session', token, { httpOnly: true, secure: true, sameSite: 'lax' });\n+ return res.json({ ok: true, redirect: from || '/' });",
          },
        ],
      },
      {
        kind: "text",
        text: "Done. Three changes:\n\n- **auth.ts** — all redirect paths now go through `redirectToLogin` with a typed reason\n- **redirect.ts** (new) — helper that preserves `from` and `reason` as query params\n- **routes/auth.ts** — login endpoint now sets secure cookie options and returns the redirect target\n\nThe user will be sent back to their original page after logging in.",
      },
    ]),
    msg("td-m5", "user", [
      {
        kind: "text",
        text: "Nice. Can you add a test for the expired-token redirect? Then open a PR.",
      },
    ]),
    msg("td-m6", "assistant", [
      {
        kind: "thought",
        text: "Check existing test structure and add a focused test for the expired token case.",
      },
      {
        kind: "tool",
        toolCallId: "td-t6",
        title: "Read tests/middleware/auth.test.ts",
        status: "completed",
      },
      {
        kind: "text",
        text: "Found the existing test file. I'll add a test for the expired-token path — it should verify the 307 status, the `/login` pathname, and both query params.",
      },
    ]),
    msg("td-m7", "user", [{ kind: "text", text: "Yep, go for it." }]),
    msg("td-m8", "assistant", [
      {
        kind: "tool",
        toolCallId: "td-t7",
        title: "Edit tests/middleware/auth.test.ts",
        status: "completed",
        content: [
          {
            type: "diff",
            text: "+ test('redirects with reason on expired token', async () => {\n+   const req = mockRequest({ cookies: { session: EXPIRED_TOKEN } });\n+   const res = await authMiddleware(req);\n+   expect(res.status).toBe(307);\n+   expect(url.searchParams.get('reason')).toBe('expired');\n+ });",
          },
        ],
      },
      {
        kind: "tool",
        toolCallId: "td-t8",
        title: "Run pnpm test",
        status: "completed",
        content: [
          {
            type: "terminal",
            text: " ✓ tests/middleware/auth.test.ts (4 tests) 32ms\n ✓ tests/middleware/redirect.test.ts (3 tests) 18ms\n\n Tests  15 passed (15)\n Duration  1.24s",
          },
        ],
      },
      {
        kind: "tool",
        toolCallId: "td-t9",
        title: "Create pull request #847",
        status: "completed",
        content: [
          {
            type: "terminal",
            text: "https://github.com/acme/web-app/pull/847",
          },
        ],
      },
      {
        kind: "text",
        text: "All 15 tests pass. Opened **PR #847** — it covers the redirect fix plus the new test.\n\nThe PR has 4 files: three from the redirect fix and the new test. CI should be green since all tests pass locally.",
      },
    ]),
    msg("td-m9", "user", [
      {
        kind: "text",
        text: "Looks good. Can you also kick off a build to make sure nothing else broke?",
      },
    ]),
    msg("td-m10", "assistant", [
      {
        kind: "tool",
        toolCallId: "td-t10",
        title: "Run npm run build",
        status: "completed",
        content: [
          {
            type: "terminal",
            text: " ✓ Compiled successfully\n ✓ Generating static pages (8/8)\n ✓ Collecting build traces ...",
          },
        ],
      },
      {
        kind: "text",
        text: "Build succeeded — 8 static pages generated, no warnings. The auth changes don't affect the build output since they're all server-side middleware.\n\nI also have `npm test -- --watch` running in the background so we'll catch any regressions if you push more changes.",
      },
    ]),
  ];

  return { messages, steps: [] };
}
