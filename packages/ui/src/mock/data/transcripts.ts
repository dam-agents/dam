import type { Message } from "../../types.js";
import { MOCK_SESSION_IDS, mockSessions } from "./sessions.js";

function msg(
  id: string,
  role: Message["role"],
  parts: Message["parts"],
): Message {
  return { id, role, parts, streaming: false };
}

function artifactTranscript(): Message[] {
  return [
    msg("art-m1", "user", [
      {
        kind: "text",
        text: "Review the Spring 2025 campaign brief and suggest improvements to the messaging hierarchy.",
      },
    ]),
    msg("art-m2", "assistant", [
      {
        kind: "thought",
        text: "Read the brief, check the target audience section, and compare with Q4 results.",
      },
      {
        kind: "tool",
        toolCallId: "art-t1",
        title: "Read spring-2025-brief.md",
        status: "completed",
      },
      {
        kind: "text",
        text: "I've reviewed the brief. The core message is strong but the hierarchy could be tighter. I've created an artifact with a revised version — take a look at the panel on the right.",
      },
    ]),
    msg("art-m3", "user", [
      {
        kind: "text",
        text: "Looks good, can you also add a section on tone guidelines?",
      },
    ]),
    msg("art-m4", "assistant", [
      {
        kind: "text",
        text: "Done — I've added a **Tone & Voice** section to the artifact with guidelines for the campaign. The key points:\n\n- Lead with confidence, not urgency\n- Use active voice throughout\n- Keep sentences under 20 words for headers\n- Match the optimistic-but-grounded tone from the Q4 launch\n\nThe updated artifact is in the panel.",
      },
    ]),
    msg("art-m5", "user", [
      {
        kind: "text",
        text: "Can you pull in the audience segmentation data from the Q4 retro? I want to compare how we targeted last time versus what we're proposing now.",
      },
    ]),
    msg("art-m6", "assistant", [
      {
        kind: "tool",
        toolCallId: "art-t2",
        title: "Read q4-retro-audience-segments.csv",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "art-t3",
        title: "Read q4-campaign-performance.md",
        status: "completed",
      },
      {
        kind: "text",
        text: "Here's what the Q4 data shows:\n\n**Top-performing segments (Q4):**\n1. Mid-market SaaS (35% of conversions, 2.1x ROAS)\n2. Enterprise DevOps teams (28% of conversions, 1.8x ROAS)\n3. Startup founders (22% of conversions, 3.4x ROAS — highest efficiency)\n\n**Spring 2025 brief currently targets:**\n- Enterprise only, which was our second-best segment\n- Drops startup founders entirely, despite their high ROAS\n\nI'd recommend keeping startup founders in the mix and adjusting the messaging hierarchy to lead with the efficiency angle that resonated with them. I've updated the artifact with a comparison table.",
      },
    ]),
    msg("art-m7", "user", [
      {
        kind: "text",
        text: "Good catch. Add the startup founder segment back in but keep enterprise as the primary. Also add a section on channel strategy — where should we distribute this?",
      },
    ]),
    msg("art-m8", "assistant", [
      {
        kind: "thought",
        text: "Check the channel performance data from Q4 and cross-reference with the proposed budget allocation.",
      },
      {
        kind: "tool",
        toolCallId: "art-t4",
        title: "Read q4-channel-attribution.md",
        status: "completed",
      },
      {
        kind: "text",
        text: "Updated the artifact with a **Channel Strategy** section. Based on Q4 attribution:\n\n**Recommended channel mix:**\n- **LinkedIn Sponsored Content** (40% budget) — strongest for enterprise DevOps, 1.9x ROAS\n- **Google Search** (25% budget) — high-intent traffic, best for mid-market\n- **Developer newsletters** (20% budget) — Pointer, TLDR, Changelog — strong with startup founders\n- **Twitter/X promoted** (10% budget) — brand awareness, lower direct conversion but feeds top-of-funnel\n- **Retargeting** (5% budget) — across all channels for site visitors who didn't convert\n\nThe brief now has: messaging hierarchy, tone guidelines, audience segments with comparison data, and channel strategy. Want me to add a timeline and budget breakdown?",
      },
    ]),
    msg("art-m9", "user", [
      {
        kind: "text",
        text: "Yes, add a timeline. Campaign kicks off March 10, runs 6 weeks. We have three phases: teaser, launch, sustain.",
      },
    ]),
    msg("art-m10", "assistant", [
      {
        kind: "text",
        text: 'Added the **Campaign Timeline** section:\n\n**Phase 1 — Teaser (Mar 10–16)**\n- Organic social hints and "coming soon" posts\n- Seed developer newsletters with preview content\n- Internal enablement for sales team\n\n**Phase 2 — Launch (Mar 17–30)**\n- Full paid media activation across all channels\n- Blog post + landing page go live\n- Product Hunt launch (Mar 18)\n- Webinar with customer case study (Mar 20)\n\n**Phase 3 — Sustain (Mar 31 – Apr 20)**\n- Retargeting ramp-up for non-converters\n- Second blog post with technical deep-dive\n- Adjust spend based on Week 2 performance data\n- Close out with ROI report and retro\n\nThe artifact is getting comprehensive — 6 sections now. Should I add anything else or is this ready for review?',
      },
    ]),
    msg("art-m11", "user", [
      {
        kind: "text",
        text: "Add a section on competitive positioning. How are we different from the two main competitors and how should the messaging reflect that?",
      },
    ]),
    msg("art-m12", "assistant", [
      {
        kind: "tool",
        toolCallId: "art-t5",
        title: "Read competitive-landscape-2025.md",
        status: "completed",
      },
      {
        kind: "text",
        text: 'Added **Competitive Positioning** to the artifact:\n\n**vs. Competitor A (Acme Platform)**\n- They lead on breadth of integrations (200+ vs. our 45)\n- We lead on **depth of automation** — our agents actually complete work, theirs only notify\n- Messaging angle: "Not just alerts — actual outcomes"\n\n**vs. Competitor B (Orion Dev)**\n- They\'re cheaper at the entry tier ($29 vs. our $49)\n- We lead on **enterprise security** — SOC 2 Type II, private VPC, audit logs\n- Messaging angle: "Enterprise-grade from day one"\n\n**Key differentiator to emphasize:**\n- Neither competitor offers scheduled autonomous agents\n- This is our unique wedge — "Set it and forget it" automation\n- Should be the hero message in Phase 2 launch content\n\nThe brief is now 7 sections. This feels solid for a review pass.',
      },
    ]),
    msg("art-m13", "user", [
      {
        kind: "text",
        text: "One more thing — add success metrics. What KPIs should we track and what are our targets?",
      },
    ]),
    msg("art-m14", "assistant", [
      {
        kind: "text",
        text: "Added **Success Metrics & KPIs** as the final section:\n\n**Primary KPIs:**\n| Metric | Target | Measurement |\n|--------|--------|------------|\n| Marketing Qualified Leads | 1,200 | Hubspot |\n| Pipeline Generated | $2.4M | Salesforce |\n| ROAS (blended) | 2.5x | Attribution model |\n| Trial Signups | 800 | Product analytics |\n\n**Secondary KPIs:**\n- Brand search volume: +40% vs. pre-campaign baseline\n- Newsletter subscriber growth: +2,000 net new\n- Webinar attendance: 300+ registrations, 45% show rate\n- Content engagement: avg. 3:20 time-on-page for campaign landing page\n\n**Reporting cadence:**\n- Daily: spend and conversion dashboards\n- Weekly: channel performance review with optimization recommendations\n- End of campaign: full retro with ROI analysis\n\nThe artifact now has 8 sections covering the complete campaign strategy. Ready for stakeholder review.",
      },
    ]),
    msg("art-m15", "user", [
      {
        kind: "text",
        text: "This looks great. Can you do a final pass on the whole document and make sure the messaging is consistent throughout?",
      },
    ]),
    msg("art-m16", "assistant", [
      {
        kind: "thought",
        text: "Re-read the full artifact to check for consistency in messaging, tone, and terminology across all 8 sections.",
      },
      {
        kind: "text",
        text: 'I\'ve done a consistency pass across all 8 sections. Changes made:\n\n1. **Unified terminology** — was inconsistent between "agents", "autonomous agents", and "AI agents". Standardized to "autonomous agents" for external messaging, "agents" for internal references\n2. **Tone alignment** — the competitive positioning section was more aggressive than the tone guidelines suggested. Softened to match the "confident, not urgent" direction\n3. **Audience threading** — made sure startup founder messaging appears in channel strategy (newsletters) and timeline (Product Hunt), not just the audience section\n4. **CTA consistency** — all sections now point to the same primary CTA: "Start a free trial"\n5. **Formatting** — standardized header levels, added consistent bullet formatting\n\nThe artifact is polished and ready to share. All 8 sections are aligned on message, tone, and audience targeting.',
      },
    ]),
  ];
}

function longChatTranscript(): Message[] {
  const messages: Message[] = [];
  let idx = 0;
  const m = (role: Message["role"], parts: Message["parts"]) => {
    idx++;
    messages.push(msg(`lc-m${idx}`, role, parts));
  };

  m("user", [
    {
      kind: "text",
      text: "Let's set up the CI pipeline for the new monorepo. Start with linting and type checking.",
    },
  ]);
  m("assistant", [
    {
      kind: "thought",
      text: "Check existing config files and package.json scripts.",
    },
    {
      kind: "tool",
      toolCallId: "lc-t1",
      title: "Read package.json",
      status: "completed",
    },
    {
      kind: "tool",
      toolCallId: "lc-t2",
      title: "Read .eslintrc.js",
      status: "completed",
    },
    {
      kind: "text",
      text: "Found the existing ESLint config and TypeScript setup. The repo uses pnpm workspaces with 4 packages. I'll create a GitHub Actions workflow that runs lint and type-check across all packages.\n\nHere's what I'm setting up:\n- **Lint**: `pnpm run lint` at the root (already configured)\n- **Type check**: `pnpm run typecheck` across all workspaces\n- **Trigger**: On push to main and on PRs",
    },
  ]);

  m("user", [{ kind: "text", text: "Add tests too. We use vitest." }]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "lc-t3",
      title: "Read vitest.config.ts",
      status: "completed",
    },
    {
      kind: "tool",
      toolCallId: "lc-t4",
      title: "Edit .github/workflows/ci.yml",
      status: "completed",
      content: [
        {
          type: "diff",
          text: "+ - name: Run tests\n+   run: pnpm test -- --reporter=verbose",
        },
      ],
    },
    {
      kind: "text",
      text: "Added the test step. The pipeline now runs in this order:\n1. Install dependencies (with pnpm cache)\n2. Lint\n3. Type check\n4. Tests\n\nAll steps run in parallel where possible.",
    },
  ]);

  m("user", [
    {
      kind: "text",
      text: "Can we add a build step and make it cache node_modules properly?",
    },
  ]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "lc-t5",
      title: "Edit .github/workflows/ci.yml",
      status: "completed",
      content: [
        {
          type: "diff",
          text: "+ - uses: actions/cache@v4\n+   with:\n+     path: node_modules\n+     key: ${{ runner.os }}-pnpm-${{ hashFiles('pnpm-lock.yaml') }}",
        },
      ],
    },
    {
      kind: "text",
      text: "Updated the workflow with:\n- **pnpm store caching** using `actions/cache@v4` — keys on the lockfile hash\n- **Build step** after tests pass: `pnpm build`\n- **Artifact upload** for the build output so downstream jobs can use it\n\nThe full pipeline should take about 3-4 minutes with a warm cache.",
    },
  ]);

  m("user", [
    { kind: "text", text: "Now add a deploy step that only runs on main." },
  ]);
  m("assistant", [
    {
      kind: "thought",
      text: "Need to add a conditional job that depends on the build job and only triggers on the main branch.",
    },
    {
      kind: "tool",
      toolCallId: "lc-t6",
      title: "Edit .github/workflows/ci.yml",
      status: "completed",
      content: [
        {
          type: "diff",
          text: "+  deploy:\n+    needs: build\n+    if: github.ref == 'refs/heads/main'\n+    runs-on: ubuntu-latest\n+    steps:\n+      - uses: actions/checkout@v4\n+      - name: Deploy to staging\n+        run: ./scripts/deploy.sh staging",
        },
      ],
    },
    {
      kind: "text",
      text: "Added a deploy job that:\n- Only runs on pushes to `main` (not on PRs)\n- Depends on the build job passing\n- Deploys to staging using the existing deploy script\n\nWant me to also add a production deploy with manual approval?",
    },
  ]);

  m("user", [
    { kind: "text", text: "Yes, add prod deploy with manual approval gate." },
  ]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "lc-t7",
      title: "Edit .github/workflows/ci.yml",
      status: "completed",
    },
    {
      kind: "text",
      text: "Done. The production deploy:\n- Uses a GitHub Environment called `production` with required reviewers\n- Runs after staging deploy succeeds\n- Includes a rollback step if the health check fails\n\nThe full pipeline flow:\n```\nlint + typecheck + test → build → deploy staging → deploy prod (manual gate)\n```",
    },
  ]);

  m("user", [
    { kind: "text", text: "Let's also add Slack notifications for failures." },
  ]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "lc-t8",
      title: "Edit .github/workflows/ci.yml",
      status: "completed",
    },
    {
      kind: "text",
      text: "Added Slack notifications using the `slackapi/slack-github-action` action. It posts to `#ci-alerts` when:\n- Any job fails\n- Production deploy completes (success or failure)\n\nThe message includes the commit author, branch, and a link to the workflow run.",
    },
  ]);

  m("user", [
    {
      kind: "text",
      text: "Can you add a matrix strategy for testing across Node 18 and 20?",
    },
  ]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "lc-t9",
      title: "Edit .github/workflows/ci.yml",
      status: "completed",
      content: [
        {
          type: "diff",
          text: "+    strategy:\n+      matrix:\n+        node-version: [18, 20]\n+    steps:\n+      - uses: actions/setup-node@v4\n+        with:\n+          node-version: ${{ matrix.node-version }}",
        },
      ],
    },
    {
      kind: "text",
      text: "Updated the test job with a matrix strategy. It now runs tests on both Node 18 and Node 20 in parallel. The build and deploy jobs still run on Node 20 only.\n\nThe full CI config is about 120 lines now. Want me to show you the complete file?",
    },
  ]);

  m("user", [
    { kind: "text", text: "Show me a summary of everything we set up." },
  ]);
  m("assistant", [
    {
      kind: "text",
      text: "Here's the complete CI/CD pipeline we built:\n\n**Jobs:**\n1. **Lint & Type Check** — runs ESLint and TypeScript compiler\n2. **Test** — vitest across Node 18 and 20 (matrix)\n3. **Build** — compiles all packages, uploads artifacts\n4. **Deploy Staging** — auto-deploys on main merges\n5. **Deploy Production** — manual approval gate via GitHub Environments\n\n**Features:**\n- pnpm dependency caching (keyed on lockfile hash)\n- Slack notifications on failures and prod deploys\n- Rollback on failed health checks\n- ~3-4 min with warm cache, ~6 min cold\n\n**Files modified:**\n- `.github/workflows/ci.yml` (new)\n- `package.json` — added `typecheck` script\n- `vitest.config.ts` — added verbose reporter for CI\n\nAll tests pass locally. Ready to push whenever you are.",
    },
  ]);

  return messages;
}

function diffsTranscript(): Message[] {
  const messages: Message[] = [];
  let idx = 0;
  const m = (role: Message["role"], parts: Message["parts"]) => {
    idx++;
    messages.push(msg(`diff-m${idx}`, role, parts));
  };

  m("user", [
    {
      kind: "text",
      text: "Refactor the authentication module to use refresh tokens. The current implementation stores the session in a cookie with a 24h expiry — switch to short-lived access tokens (15 min) with a long-lived refresh token stored in an HTTP-only cookie.",
    },
  ]);
  m("assistant", [
    {
      kind: "thought",
      text: "Read the current auth module, check cookie configuration, and plan the token pair approach.",
    },
    {
      kind: "tool",
      toolCallId: "diff-t1",
      title: "Read src/auth/session.ts",
      status: "completed",
    },
    {
      kind: "tool",
      toolCallId: "diff-t2",
      title: "Read src/auth/middleware.ts",
      status: "completed",
    },
    {
      kind: "tool",
      toolCallId: "diff-t3",
      title: "Read src/config/auth.ts",
      status: "completed",
    },
    {
      kind: "text",
      text: "I've read through the auth module. Here's the plan:\n\n1. **`src/config/auth.ts`** — add token lifetime constants and refresh secret\n2. **`src/auth/tokens.ts`** — new file for `signAccessToken`, `signRefreshToken`, `verifyRefreshToken`\n3. **`src/auth/session.ts`** — replace single-cookie logic with the token pair\n4. **`src/auth/middleware.ts`** — add silent refresh on expired access tokens\n5. **`src/auth/routes/refresh.ts`** — new endpoint `POST /auth/refresh`\n\nLet me start.",
    },
  ]);
  m("user", [{ kind: "text", text: "Go ahead." }]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "diff-t4",
      title: "Edit src/config/auth.ts",
      status: "completed",
      content: [
        {
          type: "diff",
          text: `@@ -1,8 +1,14 @@
 export const AUTH_CONFIG = {
-  sessionCookieName: 'sid',
-  sessionMaxAge: 24 * 60 * 60 * 1000,  // 24 hours
-  jwtSecret: process.env.JWT_SECRET!,
+  accessTokenTtl: 15 * 60,              // 15 minutes
+  refreshTokenTtl: 30 * 24 * 60 * 60,   // 30 days
+  accessSecret: process.env.JWT_SECRET!,
+  refreshSecret: process.env.JWT_REFRESH_SECRET!,
+  cookieName: 'refresh_token',
+  cookieOptions: {
+    httpOnly: true,
+    secure: process.env.NODE_ENV === 'production',
+    sameSite: 'strict' as const,
+    path: '/auth/refresh',
+  },
 };`,
        },
      ],
    },
    {
      kind: "text",
      text: "Updated the auth config with separate access/refresh secrets and lifetimes. The refresh cookie is scoped to `/auth/refresh` so it's only sent on token renewal requests.",
    },
  ]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "diff-t5",
      title: "Create src/auth/tokens.ts",
      status: "completed",
      content: [
        {
          type: "diff",
          text: `@@ -0,0 +1,32 @@
+import jwt from 'jsonwebtoken';
+import { AUTH_CONFIG } from '../config/auth';
+
+interface TokenPayload {
+  sub: string;
+  email: string;
+  role: string;
+}
+
+export function signAccessToken(payload: TokenPayload): string {
+  return jwt.sign(payload, AUTH_CONFIG.accessSecret, {
+    expiresIn: AUTH_CONFIG.accessTokenTtl,
+  });
+}
+
+export function signRefreshToken(userId: string): string {
+  return jwt.sign(
+    { sub: userId, type: 'refresh' },
+    AUTH_CONFIG.refreshSecret,
+    { expiresIn: AUTH_CONFIG.refreshTokenTtl },
+  );
+}
+
+export function verifyRefreshToken(token: string) {
+  return jwt.verify(token, AUTH_CONFIG.refreshSecret) as {
+    sub: string;
+    type: 'refresh';
+  };
+}`,
        },
      ],
    },
    {
      kind: "text",
      text: "Created the token utility with typed payloads. Access tokens carry the full user context (sub, email, role); refresh tokens only carry the user ID.",
    },
  ]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "diff-t6",
      title: "Edit src/auth/session.ts",
      status: "completed",
      content: [
        {
          type: "diff",
          text: `@@ -1,26 +1,34 @@
-import jwt from 'jsonwebtoken';
-import { AUTH_CONFIG } from '../config/auth';
+import { AUTH_CONFIG } from '../config/auth';
+import { signAccessToken, signRefreshToken } from './tokens';

-export function createSession(res: Response, user: User) {
-  const token = jwt.sign(
-    { sub: user.id, email: user.email, role: user.role },
-    AUTH_CONFIG.jwtSecret,
-    { expiresIn: '24h' },
-  );
+export function createSession(res: Response, user: User) {
+  const accessToken = signAccessToken({
+    sub: user.id,
+    email: user.email,
+    role: user.role,
+  });

-  res.cookie(AUTH_CONFIG.sessionCookieName, token, {
-    httpOnly: true,
-    secure: process.env.NODE_ENV === 'production',
-    maxAge: AUTH_CONFIG.sessionMaxAge,
-    sameSite: 'strict',
+  const refreshToken = signRefreshToken(user.id);
+
+  res.cookie(AUTH_CONFIG.cookieName, refreshToken, {
+    ...AUTH_CONFIG.cookieOptions,
+    maxAge: AUTH_CONFIG.refreshTokenTtl * 1000,
   });

-  return { token };
+  return { accessToken, refreshToken };
 }

-export function destroySession(res: Response) {
-  res.clearCookie(AUTH_CONFIG.sessionCookieName);
+export function destroySession(res: Response) {
+  res.clearCookie(AUTH_CONFIG.cookieName, {
+    path: AUTH_CONFIG.cookieOptions.path,
+  });
 }`,
        },
      ],
    },
    {
      kind: "text",
      text: "Refactored `session.ts` to issue a token pair instead of a single JWT cookie. `createSession` now returns both tokens — the access token goes in the response body for the client to store in memory, while the refresh token is set as an HTTP-only cookie.",
    },
  ]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "diff-t7",
      title: "Edit src/auth/middleware.ts",
      status: "completed",
      content: [
        {
          type: "diff",
          text: `@@ -1,18 +1,43 @@
-import jwt from 'jsonwebtoken';
-import { AUTH_CONFIG } from '../config/auth';
+import jwt from 'jsonwebtoken';
+import { AUTH_CONFIG } from '../config/auth';
+import { signAccessToken, verifyRefreshToken } from './tokens';
+import { findUserById } from '../db/users';

-export function authMiddleware(req, res, next) {
-  const token = req.cookies[AUTH_CONFIG.sessionCookieName];
-  if (!token) return res.status(401).json({ error: 'Not authenticated' });
+export function authMiddleware(req, res, next) {
+  const header = req.headers.authorization;
+  if (!header?.startsWith('Bearer ')) {
+    return res.status(401).json({ error: 'Missing access token' });
+  }

-  try {
-    const payload = jwt.verify(token, AUTH_CONFIG.jwtSecret);
-    req.user = payload;
-    next();
-  } catch {
-    res.clearCookie(AUTH_CONFIG.sessionCookieName);
-    return res.status(401).json({ error: 'Invalid session' });
+  const accessToken = header.slice(7);
+  try {
+    req.user = jwt.verify(accessToken, AUTH_CONFIG.accessSecret);
+    return next();
+  } catch (err) {
+    if (err.name !== 'TokenExpiredError') {
+      return res.status(401).json({ error: 'Invalid token' });
+    }
+  }
+
+  // Access token expired — attempt silent refresh
+  const refreshCookie = req.cookies[AUTH_CONFIG.cookieName];
+  if (!refreshCookie) {
+    return res.status(401).json({ error: 'Session expired' });
+  }
+
+  try {
+    const { sub } = verifyRefreshToken(refreshCookie);
+    const user = await findUserById(sub);
+    if (!user) return res.status(401).json({ error: 'User not found' });
+
+    const newAccess = signAccessToken({
+      sub: user.id,
+      email: user.email,
+      role: user.role,
+    });
+    res.setHeader('X-Access-Token', newAccess);
+    req.user = jwt.decode(newAccess);
+    next();
+  } catch {
+    res.clearCookie(AUTH_CONFIG.cookieName);
+    return res.status(401).json({ error: 'Refresh token invalid' });
   }
 }`,
        },
      ],
    },
    {
      kind: "text",
      text: "The middleware now checks the `Authorization: Bearer` header first. If the access token is expired, it falls back to a silent refresh using the cookie — issuing a new access token via the `X-Access-Token` response header so the client can update without a redirect.",
    },
  ]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "diff-t8",
      title: "Create src/auth/routes/refresh.ts",
      status: "completed",
      content: [
        {
          type: "diff",
          text: `@@ -0,0 +1,28 @@
+import { Router } from 'express';
+import { AUTH_CONFIG } from '../../config/auth';
+import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../tokens';
+import { findUserById } from '../../db/users';
+
+const router = Router();
+
+router.post('/auth/refresh', async (req, res) => {
+  const token = req.cookies[AUTH_CONFIG.cookieName];
+  if (!token) return res.status(401).json({ error: 'No refresh token' });
+
+  try {
+    const { sub } = verifyRefreshToken(token);
+    const user = await findUserById(sub);
+    if (!user) return res.status(401).json({ error: 'User not found' });
+
+    const accessToken = signAccessToken({
+      sub: user.id,
+      email: user.email,
+      role: user.role,
+    });
+
+    // Rotate refresh token on each use
+    const refreshToken = signRefreshToken(user.id);
+    res.cookie(AUTH_CONFIG.cookieName, refreshToken, {
+      ...AUTH_CONFIG.cookieOptions,
+      maxAge: AUTH_CONFIG.refreshTokenTtl * 1000,
+    });
+
+    res.json({ accessToken });
+  } catch {
+    res.clearCookie(AUTH_CONFIG.cookieName);
+    res.status(401).json({ error: 'Invalid refresh token' });
+  }
+});
+
+export default router;`,
        },
      ],
    },
    {
      kind: "text",
      text: "Created the explicit refresh endpoint at `POST /auth/refresh`. It also rotates the refresh token on each use — this limits the damage if a refresh token is leaked, since the old one becomes invalid.",
    },
  ]);
  m("assistant", [
    {
      kind: "tool",
      toolCallId: "diff-t9",
      title: "Run pnpm test",
      status: "completed",
      content: [
        {
          type: "terminal",
          text: "PASS  src/auth/__tests__/tokens.test.ts (6 tests)\nPASS  src/auth/__tests__/session.test.ts (4 tests)\nPASS  src/auth/__tests__/middleware.test.ts (8 tests)\nPASS  src/auth/__tests__/refresh.test.ts (5 tests)\n\nTest Suites:  4 passed, 4 total\nTests:        23 passed, 23 total\nTime:         1.84s",
        },
      ],
    },
    {
      kind: "text",
      text: "All 23 tests pass. Here's a summary of all the changes:\n\n**Modified files:**\n- `src/config/auth.ts` — separate access/refresh secrets and token lifetimes\n- `src/auth/session.ts` — issues token pair instead of single cookie\n- `src/auth/middleware.ts` — Bearer token auth with silent refresh fallback\n\n**New files:**\n- `src/auth/tokens.ts` — token signing and verification utilities\n- `src/auth/routes/refresh.ts` — explicit refresh endpoint with token rotation\n\nThe client will need to store the access token in memory (not localStorage) and include it as `Authorization: Bearer <token>`. When the middleware silently refreshes, the new token comes back in `X-Access-Token`. For explicit refresh (e.g., on app load), use `POST /auth/refresh`.",
    },
  ]);

  return messages;
}

function defaultTranscript(
  agentId: string,
  sessionId: string,
  title: string,
): Message[] {
  const p = `${sessionId}-m`;
  return [
    msg(`${p}1`, "user", [
      {
        kind: "text",
        text: `Can you pick up "${title}"? Start from what's already in the workspace and tell me what you find.`,
      },
    ]),
    msg(`${p}2`, "assistant", [
      {
        kind: "thought",
        text: "Check the README and the existing source before proposing changes.",
      },
      {
        kind: "tool",
        toolCallId: `${p}t1`,
        title: "Read README.md",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: `${p}t2`,
        title: "List files in src/",
        status: "completed",
        content: [
          {
            type: "terminal",
            text: "src/\n  components/\n  lib/\n  index.ts",
          },
        ],
      },
      {
        kind: "text",
        text: `I've gone through the workspace for **${title}**. Here's where things stand:\n\n- The main entry point is \`src/index.ts\`, and most of the logic lives in \`src/lib/\`.\n- There are no tests covering the current flow yet.\n- Two TODOs in \`src/components/\` look related to this work.\n\nI'd suggest starting with the TODOs, then adding a small test so we can check the change. Want me to go ahead?`,
      },
    ]),
    msg(`${p}3`, "user", [
      { kind: "text", text: "Yes, go ahead. Keep the change small." },
    ]),
    msg(`${p}4`, "assistant", [
      {
        kind: "tool",
        toolCallId: `${p}t3`,
        title: "Edit src/components/summary.tsx",
        status: "completed",
        content: [
          {
            type: "diff",
            text: "- // TODO: handle empty state\n+ if (items.length === 0) return <EmptyState />;",
          },
        ],
      },
      {
        kind: "tool",
        toolCallId: `${p}t4`,
        title: "Run pnpm test",
        status: "completed",
        content: [{ type: "terminal", text: "✓ 12 tests passed" }],
      },
      {
        kind: "text",
        text: "Done. I handled the empty state in `summary.tsx` and all 12 tests pass. I also saved a short write-up as an artifact so you can share it.",
      },
    ]),
  ];
}

export function mockTranscript(agentId: string, sessionId: string): Message[] {
  if (sessionId === MOCK_SESSION_IDS.artifact) {
    return artifactTranscript();
  }
  if (sessionId === MOCK_SESSION_IDS.longChat) {
    return longChatTranscript();
  }
  if (sessionId === MOCK_SESSION_IDS.diffs) {
    return diffsTranscript();
  }

  const list = (mockSessions[agentId] ?? []) as {
    sessionId: string;
    title?: string;
  }[];
  const title =
    list.find((s) => s.sessionId === sessionId)?.title ?? "this task";
  return defaultTranscript(agentId, sessionId, title);
}

export function mockReply(text: string): string {
  const trimmed = text.trim();
  const subject =
    trimmed.length > 60 ? `${trimmed.slice(0, 57).trimEnd()}…` : trimmed;
  return `Got it: "${subject}". This is a prototype, so I'm not running anything, but a real agent would pick this up in its workspace and report back here.`;
}
