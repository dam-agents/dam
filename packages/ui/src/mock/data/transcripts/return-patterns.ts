import type { Message } from "../../../types.js";
import { msg } from "./helpers.js";
import { TOOLS_DEMO_CHANGE_CARDS, toolsDemoTranscript } from "./tools-demo.js";
import type { TranscriptMeta } from "./types.js";

export type ReturnPattern = "pill" | "header" | "jump" | "scrollbar" | "badge";

export { TOOLS_DEMO_CHANGE_CARDS };

export function returnPatternTranscript(): TranscriptMeta {
  const base = toolsDemoTranscript();
  const extra = paddingMessages();
  return {
    messages: [...base.messages, ...extra],
    steps: [],
  };
}

function paddingMessages(): Message[] {
  const m: Message[] = [];
  let idx = 100;

  const add = (role: Message["role"], parts: Message["parts"]) => {
    idx++;
    m.push(msg(`rp-m${idx}`, role, parts));
  };

  add("user", [
    {
      kind: "text",
      text: "Great, the auth fix looks solid. Can we also add rate limiting to the login endpoint? We've been getting hit by credential-stuffing bots.",
    },
  ]);
  add("assistant", [
    {
      kind: "thought",
      text: "Check if there's an existing rate limiter in the project, look at the express middleware setup.",
    },
    {
      kind: "tool",
      toolCallId: "rp-t1",
      title: "Read package.json",
      status: "completed",
    },
    {
      kind: "tool",
      toolCallId: "rp-t2",
      title: "Read src/middleware/index.ts",
      status: "completed",
    },
    {
      kind: "text",
      text: "I don't see an existing rate limiter. I'd recommend `express-rate-limit` with a Redis store for persistence across instances. We can set it up with:\n\n- **Login endpoint**: 5 attempts per 15 minutes per IP\n- **General API**: 100 requests per minute per IP\n- **Custom response**: 429 with `Retry-After` header\n\nThe Redis store means rate limits survive server restarts and work across load-balanced instances. Want me to set this up?",
    },
  ]);

  add("user", [
    {
      kind: "text",
      text: "Yeah, go ahead. But use the in-memory store for now — we'll add Redis later. Also add a separate limit for the password reset endpoint.",
    },
  ]);
  add("assistant", [
    {
      kind: "tool",
      toolCallId: "rp-t3",
      title: "Install express-rate-limit",
      status: "completed",
      content: [
        {
          type: "terminal",
          text: "added 1 package in 2.1s",
        },
      ],
    },
    {
      kind: "tool",
      toolCallId: "rp-t4",
      title: "Create src/middleware/rate-limit.ts",
      status: "completed",
    },
    {
      kind: "tool",
      toolCallId: "rp-t5",
      title: "Edit src/routes/auth.ts",
      status: "completed",
    },
    {
      kind: "text",
      text: "Done. Set up three rate limiters:\n\n- **Login**: 5 attempts / 15 min per IP — returns 429 with retry info\n- **Password reset**: 3 attempts / 60 min per IP — tighter since it triggers emails\n- **General API**: 100 / min per IP — applied globally\n\nAll use the in-memory store. When you're ready for Redis, just swap the store constructor — the limits and configuration stay the same.",
    },
  ]);

  add("user", [
    {
      kind: "text",
      text: "What about the error response format? Does it match our existing error schema?",
    },
  ]);
  add("assistant", [
    {
      kind: "tool",
      toolCallId: "rp-t6",
      title: "Read src/lib/errors.ts",
      status: "completed",
    },
    {
      kind: "text",
      text: 'Good catch — your error responses use `{ error: string, code: string, details?: object }` but `express-rate-limit` sends a plain text response by default. I\'ve updated the rate limiter to match:\n\n```json\n{\n  "error": "Too many requests",\n  "code": "RATE_LIMIT_EXCEEDED",\n  "details": {\n    "retryAfter": 847,\n    "limit": 5,\n    "window": "15m"\n  }\n}\n```\n\nThis way clients can parse the structured error and show the user when they can try again.',
    },
  ]);

  add("user", [
    {
      kind: "text",
      text: "Perfect. Let's also add request logging. I want to see the rate limit headers in the logs so we can tune the thresholds later.",
    },
  ]);
  add("assistant", [
    {
      kind: "tool",
      toolCallId: "rp-t7",
      title: "Edit src/middleware/logger.ts",
      status: "completed",
    },
    {
      kind: "text",
      text: "Updated the request logger to include rate limit headers in every log entry:\n\n- `X-RateLimit-Limit` — the window max\n- `X-RateLimit-Remaining` — how many requests are left\n- `X-RateLimit-Reset` — when the window resets (epoch seconds)\n\nThis'll show up in your structured logs so you can query Datadog or Grafana to see which endpoints are hitting limits most often. Useful for tuning.",
    },
  ]);

  add("user", [
    {
      kind: "text",
      text: "Can you also add a health check endpoint that's exempt from rate limiting? Kubernetes needs it for readiness probes.",
    },
  ]);
  add("assistant", [
    {
      kind: "tool",
      toolCallId: "rp-t8",
      title: "Create src/routes/health.ts",
      status: "completed",
    },
    {
      kind: "tool",
      toolCallId: "rp-t9",
      title: "Edit src/middleware/rate-limit.ts",
      status: "completed",
    },
    {
      kind: "text",
      text: 'Added `GET /health` and `GET /ready` — both exempt from rate limiting via the `skip` function. The health endpoint returns:\n\n```json\n{\n  "status": "ok",\n  "version": "2.4.0",\n  "uptime": 84723\n}\n```\n\nThe readiness probe also checks the database connection, so Kubernetes won\'t route traffic until the app can actually serve requests.',
    },
  ]);

  add("user", [
    {
      kind: "text",
      text: "Looks good. One more — can you set up the CORS config? We need to allow requests from our dashboard at dashboard.acme.com and the staging version.",
    },
  ]);
  add("assistant", [
    {
      kind: "tool",
      toolCallId: "rp-t10",
      title: "Create src/middleware/cors.ts",
      status: "completed",
    },
    {
      kind: "text",
      text: "CORS is configured with an origin allowlist:\n\n- `https://dashboard.acme.com`\n- `https://staging.dashboard.acme.com`\n- `http://localhost:3000` (dev only, behind `NODE_ENV` check)\n\nCredentials are allowed so the auth cookies work cross-origin, and the allowed methods are scoped to what the API actually uses: `GET, POST, PUT, DELETE, PATCH`. Preflight responses are cached for 1 hour.",
    },
  ]);

  add("user", [
    {
      kind: "text",
      text: "Great work on all of this. Can you write up a summary of everything we've done in this session?",
    },
  ]);
  add("assistant", [
    {
      kind: "text",
      text: "Here's the full summary of changes in this session:\n\n**Auth redirect fix** (PR #847)\n- Created `redirectToLogin` helper with typed reasons and return URL\n- Updated middleware to use structured redirects for all failure cases\n- Updated login route with secure cookie options and redirect support\n- Added expired-token test\n\n**Rate limiting**\n- Added `express-rate-limit` with three tiers: login (5/15min), password reset (3/60min), general (100/min)\n- Custom error responses matching existing schema\n- Rate limit headers included in structured logs\n\n**Infrastructure**\n- Health check endpoints (`/health`, `/ready`) exempt from rate limiting\n- CORS configured for dashboard origins with credential support\n- Readiness probe includes database connectivity check\n\nAll tests pass, build succeeds, and the auth PR is open. The rate limiting and infrastructure changes are still local — want me to open a separate PR for those?",
    },
  ]);

  return m;
}
