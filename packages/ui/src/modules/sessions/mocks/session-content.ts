import type { Message } from "../../../types.js";

export const MOCK_MESSAGES: Record<string, Message[]> = {
  "sess-001": [
    {
      id: "m1-1",
      role: "user",
      parts: [
        {
          kind: "text",
          text: "Can you refactor the auth module to use JWT instead of session cookies?",
        },
      ],
      streaming: false,
    },
    {
      id: "m1-2",
      role: "assistant",
      parts: [
        {
          kind: "thought",
          text: "The user wants to migrate from session-based auth to JWT tokens. I'll need to update the middleware, the login endpoint, and the token validation logic.",
        },
        {
          kind: "text",
          text: "I'll refactor the auth module to use JWT. Here's my plan:\n\n1. Replace the session middleware with a JWT verification middleware\n2. Update the login endpoint to issue signed tokens\n3. Add a token refresh mechanism\n\nLet me start with the middleware.",
        },
      ],
      streaming: false,
    },
    {
      id: "m1-3",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-read-1",
          title: "Read src/middleware/auth.ts",
          status: "completed",
          content: [
            {
              type: "content",
              text: "import { Request, Response, NextFunction } from 'express';\nimport session from 'express-session';\n\nexport function authMiddleware(req: Request, res: Response, next: NextFunction) {\n  if (!req.session.userId) {\n    return res.status(401).json({ error: 'Unauthorized' });\n  }\n  next();\n}",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "m1-4",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-edit-1",
          title: "Edit src/middleware/auth.ts",
          status: "completed",
          content: [
            {
              type: "diff",
              text: "- import session from 'express-session';\n+ import jwt from 'jsonwebtoken';\n+ import { JWT_SECRET } from '../config';\n\n  export function authMiddleware(req: Request, res: Response, next: NextFunction) {\n-   if (!req.session.userId) {\n+   const token = req.headers.authorization?.split(' ')[1];\n+   if (!token) {\n      return res.status(401).json({ error: 'Unauthorized' });\n    }\n+   try {\n+     const payload = jwt.verify(token, JWT_SECRET);\n+     req.user = payload;\n+   } catch {\n+     return res.status(401).json({ error: 'Invalid token' });\n+   }\n    next();\n  }",
            },
          ],
        },
        {
          kind: "text",
          text: "I've updated the auth middleware to verify JWT tokens from the `Authorization` header instead of checking session cookies. Now let me update the login endpoint to issue tokens.",
        },
      ],
      streaming: false,
    },
    {
      id: "m1-5",
      role: "user",
      parts: [
        {
          kind: "text",
          text: "Looks good. What about the refresh token logic?",
        },
      ],
      streaming: false,
    },
    {
      id: "m1-6",
      role: "assistant",
      parts: [
        {
          kind: "text",
          text: "I'll add a refresh token mechanism using a separate long-lived token stored in an HTTP-only cookie. The access token will be short-lived (15 min) and the refresh token will last 7 days.\n\nCreating `src/middleware/refresh.ts`:",
        },
        {
          kind: "tool",
          toolCallId: "tc-write-1",
          title: "Write src/middleware/refresh.ts",
          status: "completed",
          content: [
            {
              type: "content",
              text: "import jwt from 'jsonwebtoken';\nimport { JWT_SECRET, REFRESH_SECRET } from '../config';\n\nexport function refreshHandler(req, res) {\n  const refreshToken = req.cookies.refreshToken;\n  if (!refreshToken) return res.status(401).json({ error: 'No refresh token' });\n\n  try {\n    const payload = jwt.verify(refreshToken, REFRESH_SECRET);\n    const accessToken = jwt.sign(\n      { userId: payload.userId },\n      JWT_SECRET,\n      { expiresIn: '15m' }\n    );\n    res.json({ accessToken });\n  } catch {\n    res.status(401).json({ error: 'Invalid refresh token' });\n  }\n}",
            },
          ],
        },
      ],
      streaming: false,
    },
  ],

  "sess-002": [
    {
      id: "m2-1",
      role: "user",
      parts: [
        {
          kind: "text",
          text: "The API is timing out on the /analytics endpoint when there are more than 10k records. Can you investigate and fix it?",
        },
      ],
      streaming: false,
    },
    {
      id: "m2-2",
      role: "assistant",
      parts: [
        {
          kind: "thought",
          text: "I should look at the analytics endpoint to find the performance bottleneck. Likely an unindexed query or missing pagination.",
        },
        {
          kind: "text",
          text: "Let me look at the analytics endpoint to identify the bottleneck.",
        },
      ],
      streaming: false,
    },
    {
      id: "m2-3",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-read-2",
          title: "Read src/routes/analytics.ts",
          status: "completed",
          content: [
            {
              type: "content",
              text: "export async function getAnalytics(req, res) {\n  const records = await db.query('SELECT * FROM events WHERE org_id = $1', [req.orgId]);\n  const aggregated = records.rows.map(r => ({\n    ...r,\n    enriched: await enrichRecord(r)\n  }));\n  res.json(aggregated);\n}",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "m2-4",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-read-schema",
          title: "Read src/db/schema.ts",
          status: "completed",
          content: [
            {
              type: "content",
              text: "export const events = pgTable('events', {\n  id: uuid('id').primaryKey(),\n  orgId: uuid('org_id').notNull(),\n  type: text('type').notNull(),\n  payload: jsonb('payload'),\n  createdAt: timestamp('created_at').defaultNow(),\n});",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "m2-5",
      role: "assistant",
      parts: [
        {
          kind: "text",
          text: "Found the issue. The query fetches **all** events without pagination, and `enrichRecord` is called sequentially for each row using `await` in a `.map()`. This means:\n\n1. No `LIMIT`/`OFFSET` — loads entire dataset into memory\n2. N+1 enrichment — each record triggers a separate async call\n3. No index on `(org_id, created_at)` — full table scan\n\nI'll fix this by adding cursor-based pagination and batching the enrichment. I need to run a database migration to add an index first.",
        },
      ],
      streaming: false,
    },
    {
      id: "m2-6",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-terminal-1",
          title:
            "Run: psql -c 'CREATE INDEX CONCURRENTLY idx_events_org_created ON events(org_id, created_at DESC)'",
          status: "pending_approval",
        },
      ],
      streaming: false,
    },
  ],

  "sess-003": [
    {
      id: "m3-1",
      role: "user",
      parts: [
        {
          kind: "text",
          text: "Write unit tests for the UserService class in src/services/user-service.ts",
        },
      ],
      streaming: false,
    },
    {
      id: "m3-2",
      role: "assistant",
      parts: [
        {
          kind: "text",
          text: "I'll write comprehensive unit tests for UserService. Let me first read the implementation to understand the methods and dependencies.",
        },
      ],
      streaming: false,
    },
    {
      id: "m3-3",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-read-3",
          title: "Read src/services/user-service.ts",
          status: "completed",
          content: [
            {
              type: "content",
              text: "import { db } from '../db';\nimport { hashPassword, verifyPassword } from '../utils/crypto';\nimport { sendVerificationEmail } from '../mail';\n\nexport class UserService {\n  async createUser(email: string, password: string) {\n    const hash = await hashPassword(password);\n    const user = await db.users.create({ email, passwordHash: hash });\n    await sendVerificationEmail(user.email, user.id);\n    return user;\n  }\n\n  async authenticate(email: string, password: string) {\n    const user = await db.users.findByEmail(email);\n    if (!user) throw new Error('User not found');\n    const valid = await verifyPassword(password, user.passwordHash);\n    if (!valid) throw new Error('Invalid credentials');\n    return user;\n  }\n\n  async updateProfile(userId: string, data: { name?: string; avatar?: string }) {\n    return db.users.update(userId, data);\n  }\n}",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "m3-4",
      role: "assistant",
      parts: [
        {
          kind: "text",
          text: "Now I'll create the test file with tests for `createUser`, `authenticate`, and `updateProfile`:",
        },
        {
          kind: "tool",
          toolCallId: "tc-write-3",
          title: "Write src/services/__tests__/user-service.test.ts",
          status: "completed",
          content: [
            {
              type: "content",
              text: "import { describe, it, expect, vi, beforeEach } from 'vitest';\nimport { UserService } from '../user-service';\nimport { db } from '../../db';\nimport * as crypto from '../../utils/crypto';\nimport * as mail from '../../mail';\n\nvi.mock('../../db');\nvi.mock('../../utils/crypto');\nvi.mock('../../mail');\n\ndescribe('UserService', () => {\n  let service: UserService;\n\n  beforeEach(() => {\n    service = new UserService();\n    vi.clearAllMocks();\n  });\n\n  describe('createUser', () => {\n    it('should hash password and create user', async () => {\n      vi.mocked(crypto.hashPassword).mockResolvedValue('hashed_pw');\n      vi.mocked(db.users.create).mockResolvedValue({\n        id: '1', email: 'test@example.com', passwordHash: 'hashed_pw'\n      });\n      vi.mocked(mail.sendVerificationEmail).mockResolvedValue(undefined);\n\n      const user = await service.createUser('test@example.com', 'password123');\n\n      expect(crypto.hashPassword).toHaveBeenCalledWith('password123');\n      expect(db.users.create).toHaveBeenCalledWith({\n        email: 'test@example.com',\n        passwordHash: 'hashed_pw'\n      });\n      expect(mail.sendVerificationEmail).toHaveBeenCalledWith('test@example.com', '1');\n      expect(user.email).toBe('test@example.com');\n    });\n\n    it('should propagate db errors', async () => {\n      vi.mocked(crypto.hashPassword).mockResolvedValue('hashed');\n      vi.mocked(db.users.create).mockRejectedValue(new Error('duplicate'));\n\n      await expect(service.createUser('dup@test.com', 'pw'))\n        .rejects.toThrow('duplicate');\n    });\n  });\n\n  describe('authenticate', () => {\n    it('should return user on valid credentials', async () => {\n      const mockUser = { id: '1', email: 'a@b.com', passwordHash: 'hash' };\n      vi.mocked(db.users.findByEmail).mockResolvedValue(mockUser);\n      vi.mocked(crypto.verifyPassword).mockResolvedValue(true);\n\n      const result = await service.authenticate('a@b.com', 'correct');\n      expect(result).toEqual(mockUser);\n    });\n\n    it('should throw on unknown email', async () => {\n      vi.mocked(db.users.findByEmail).mockResolvedValue(null);\n\n      await expect(service.authenticate('x@y.com', 'pw'))\n        .rejects.toThrow('User not found');\n    });\n\n    it('should throw on wrong password', async () => {\n      vi.mocked(db.users.findByEmail).mockResolvedValue({\n        id: '1', email: 'a@b.com', passwordHash: 'hash'\n      });\n      vi.mocked(crypto.verifyPassword).mockResolvedValue(false);\n\n      await expect(service.authenticate('a@b.com', 'wrong'))\n        .rejects.toThrow('Invalid credentials');\n    });\n  });\n\n  describe('updateProfile', () => {\n    it('should update user fields', async () => {\n      vi.mocked(db.users.update).mockResolvedValue({ id: '1', name: 'New' });\n\n      const result = await service.updateProfile('1', { name: 'New' });\n      expect(db.users.update).toHaveBeenCalledWith('1', { name: 'New' });\n      expect(result.name).toBe('New');\n    });\n  });\n});",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "m3-5",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-run-3",
          title: "Run: vitest run src/services/__tests__/user-service.test.ts",
          status: "completed",
          content: [
            {
              type: "terminal",
              text: " ✓ src/services/__tests__/user-service.test.ts (6 tests)\n   ✓ UserService > createUser > should hash password and create user\n   ✓ UserService > createUser > should propagate db errors\n   ✓ UserService > authenticate > should return user on valid credentials\n   ✓ UserService > authenticate > should throw on unknown email\n   ✓ UserService > authenticate > should throw on wrong password\n   ✓ UserService > updateProfile > should update user fields\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)\n   Start at  14:32:01\n   Duration  1.23s",
            },
          ],
        },
        {
          kind: "text",
          text: "All 6 tests pass. The test file covers:\n\n- **createUser** — password hashing, DB creation, email sending, and error propagation\n- **authenticate** — valid credentials, unknown email, and wrong password\n- **updateProfile** — field updates delegated to DB\n\nEach test mocks the dependencies (`db`, `crypto`, `mail`) so they run in isolation.",
        },
      ],
      streaming: false,
    },
  ],

  "sess-sched-001": [
    {
      id: "ms1-1",
      role: "assistant",
      parts: [
        {
          kind: "text",
          text: "Starting daily security scan. Checking dependencies for known vulnerabilities and scanning for exposed secrets.",
        },
      ],
      streaming: false,
      notice: true,
    },
    {
      id: "ms1-2",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-scan-1",
          title: "Run: npm audit --json",
          status: "completed",
          content: [
            {
              type: "terminal",
              text: "found 2 vulnerabilities (1 moderate, 1 high)\n\n  moderate: Prototype Pollution in lodash\n    fix: npm audit fix\n  high: ReDoS in semver <7.5.2\n    fix: upgrade semver to >=7.5.2",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "ms1-3",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-scan-2",
          title:
            "Run: grep -r 'PRIVATE_KEY\\|SECRET\\|PASSWORD' --include='*.ts' src/",
          status: "completed",
          content: [
            {
              type: "terminal",
              text: "src/config/auth.ts:  JWT_SECRET: process.env.JWT_SECRET,\nsrc/config/auth.ts:  REFRESH_SECRET: process.env.REFRESH_SECRET,\n\n(all references use environment variables — no hardcoded secrets found)",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "ms1-4",
      role: "assistant",
      parts: [
        {
          kind: "text",
          text: "**Security scan complete.**\n\n**Vulnerabilities:** 2 found in dependencies\n- `lodash` — Prototype Pollution (moderate) → fixable with `npm audit fix`\n- `semver` <7.5.2 — ReDoS (high) → upgrade required\n\n**Secrets:** No hardcoded secrets. All sensitive values use environment variables.\n\n**Recommendation:** Run `npm audit fix` and manually upgrade `semver` to >=7.5.2.",
        },
      ],
      streaming: false,
    },
  ],

  "sess-006": [
    {
      id: "m6-1",
      role: "user",
      parts: [
        {
          kind: "text",
          text: "Mutate the parent candidate 'p2p-1' to use the new routing algorithm",
        },
      ],
      streaming: false,
    },
    {
      id: "m6-2",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-6-read",
          title: "Read packages/controller/src/candidates/p2p.go",
          status: "completed",
          content: [
            {
              type: "content",
              text: "package candidates\n\nfunc (c *P2PCandidate) Route(ctx context.Context) error {\n\treturn c.legacyRouter.Forward(ctx, c.payload)\n}",
            },
          ],
        },
        {
          kind: "text",
          text: "I can see the current routing uses `legacyRouter`. I'll update it to use the new algorithm. This requires modifying the production config — I need your approval to write the changes.",
        },
      ],
      streaming: false,
    },
  ],

  "sess-sched-002": [
    {
      id: "ms2-1",
      role: "assistant",
      parts: [
        {
          kind: "text",
          text: "Starting daily security scan. Checking dependencies for known vulnerabilities and scanning for exposed secrets.",
        },
      ],
      streaming: false,
      notice: true,
    },
    {
      id: "ms2-2",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-scan-3",
          title: "Run: npm audit --json",
          status: "completed",
          content: [
            {
              type: "terminal",
              text: "found 1 vulnerability (1 critical)\n\n  critical: Remote Code Execution in vm2 <3.9.17\n    fix: upgrade vm2 to >=3.9.17",
            },
          ],
        },
        {
          kind: "text",
          text: "**Critical vulnerability found.** I need to run `npm audit fix --force` to patch vm2. This will modify package-lock.json.",
        },
      ],
      streaming: false,
    },
  ],

  "sess-showcase": [
    {
      id: "sc-1",
      role: "user",
      parts: [
        {
          kind: "text",
          text: "Can you set up the database migration for the new notifications table and wire up the API endpoint?",
        },
      ],
      streaming: false,
    },
    {
      id: "sc-2",
      role: "assistant",
      parts: [
        {
          kind: "thought",
          text: "I need to create a notifications table with columns for recipient, type, payload, read status, and timestamps. Then I'll create a tRPC router with list/markRead/dismiss endpoints. Let me check the existing schema pattern first.",
        },
        {
          kind: "text",
          text: "I'll set up the notifications table and API. Let me check the existing schema patterns first.",
        },
      ],
      streaming: false,
    },
    {
      id: "sc-3",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-sc-read1",
          title: "Read packages/db/src/schema.ts",
          status: "completed",
          content: [
            {
              type: "content",
              text: "import { pgTable, uuid, text, timestamp, boolean, jsonb } from 'drizzle-orm/pg-core';\n\nexport const users = pgTable('users', {\n  id: uuid('id').primaryKey().defaultRandom(),\n  email: text('email').notNull().unique(),\n  name: text('name'),\n  createdAt: timestamp('created_at').defaultNow().notNull(),\n});\n\nexport const sessions = pgTable('sessions', {\n  id: uuid('id').primaryKey().defaultRandom(),\n  userId: uuid('user_id').references(() => users.id).notNull(),\n  agentId: text('agent_id').notNull(),\n  title: text('title'),\n  createdAt: timestamp('created_at').defaultNow().notNull(),\n  updatedAt: timestamp('updated_at').defaultNow().notNull(),\n});",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "sc-4",
      role: "assistant",
      parts: [
        {
          kind: "text",
          text: "Good — the pattern uses `uuid` primary keys with `defaultRandom()`, `timestamp` with `defaultNow()`, and references for foreign keys. I'll follow that pattern.\n\nHere's the notifications table schema:",
        },
        {
          kind: "tool",
          toolCallId: "tc-sc-edit1",
          title: "Edit packages/db/src/schema.ts",
          status: "completed",
          content: [
            {
              type: "diff",
              text: "+ export const notifications = pgTable('notifications', {\n+   id: uuid('id').primaryKey().defaultRandom(),\n+   recipientId: uuid('recipient_id').references(() => users.id).notNull(),\n+   type: text('type').notNull(), // 'session_complete' | 'approval_needed' | 'mention'\n+   title: text('title').notNull(),\n+   body: text('body'),\n+   payload: jsonb('payload'),\n+   read: boolean('read').default(false).notNull(),\n+   dismissed: boolean('dismissed').default(false).notNull(),\n+   createdAt: timestamp('created_at').defaultNow().notNull(),\n+ });",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "sc-5",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-sc-run1",
          title: "Run: mise run db:generate",
          status: "completed",
          content: [
            {
              type: "terminal",
              text: "drizzle-kit: v0.20.14\n\n1 table added: notifications\n1 migration generated:\n  → 0014_add_notifications_table.sql\n\n✓ Done in 0.8s",
            },
          ],
        },
        {
          kind: "text",
          text: "Migration generated. Now I'll create the tRPC router for the notifications API:",
        },
      ],
      streaming: false,
    },
    {
      id: "sc-6",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-sc-write1",
          title:
            "Write packages/api-server/src/modules/notifications/router.ts",
          status: "completed",
          content: [
            {
              type: "content",
              text: "import { z } from 'zod';\nimport { eq, and, desc } from 'drizzle-orm';\nimport { router, protectedProcedure } from '../../trpc';\nimport { notifications } from '@platform/db/schema';\n\nexport const notificationsRouter = router({\n  list: protectedProcedure\n    .input(z.object({ limit: z.number().min(1).max(50).default(20) }))\n    .query(async ({ ctx, input }) => {\n      return ctx.db\n        .select()\n        .from(notifications)\n        .where(\n          and(\n            eq(notifications.recipientId, ctx.user.id),\n            eq(notifications.dismissed, false)\n          )\n        )\n        .orderBy(desc(notifications.createdAt))\n        .limit(input.limit);\n    }),\n\n  markRead: protectedProcedure\n    .input(z.object({ id: z.string().uuid() }))\n    .mutation(async ({ ctx, input }) => {\n      await ctx.db\n        .update(notifications)\n        .set({ read: true })\n        .where(\n          and(\n            eq(notifications.id, input.id),\n            eq(notifications.recipientId, ctx.user.id)\n          )\n        );\n    }),\n\n  dismiss: protectedProcedure\n    .input(z.object({ id: z.string().uuid() }))\n    .mutation(async ({ ctx, input }) => {\n      await ctx.db\n        .update(notifications)\n        .set({ dismissed: true })\n        .where(\n          and(\n            eq(notifications.id, input.id),\n            eq(notifications.recipientId, ctx.user.id)\n          )\n        );\n    }),\n});",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "sc-notice",
      role: "assistant",
      parts: [
        {
          kind: "text",
          text: "Session paused — agent reached checkpoint",
        },
      ],
      streaming: false,
      notice: true,
    },
    {
      id: "sc-7",
      role: "user",
      parts: [
        {
          kind: "text",
          text: "Nice. Can you run the tests and also add an index on recipient_id + created_at?",
        },
      ],
      streaming: false,
    },
    {
      id: "sc-8",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-sc-run2",
          title: "Run: mise run test -- packages/api-server",
          status: "completed",
          content: [
            {
              type: "terminal",
              text: " ✓ notifications/router.test.ts (4 tests)\n   ✓ list returns only user's non-dismissed notifications\n   ✓ list respects limit parameter\n   ✓ markRead updates read status\n   ✓ dismiss sets dismissed flag\n\n Test Files  1 passed (1)\n      Tests  4 passed (4)\n   Duration  2.14s",
            },
          ],
        },
      ],
      streaming: false,
    },
    {
      id: "sc-9",
      role: "assistant",
      parts: [
        {
          kind: "text",
          text: "Tests pass. Now I'll add the composite index. This requires running a migration against the database:",
        },
        {
          kind: "tool",
          toolCallId: "tc-sc-run3",
          title:
            "Run: psql -c 'CREATE INDEX CONCURRENTLY idx_notifications_recipient_created ON notifications(recipient_id, created_at DESC)'",
          status: "pending_approval",
        },
      ],
      streaming: false,
    },
    {
      id: "sc-10",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-sc-run-fail",
          title:
            "Run: curl -s https://internal-registry.corp.net/v2/manifests/latest",
          status: "failed",
          content: [
            {
              type: "terminal",
              text: "curl: (7) Failed to connect to internal-registry.corp.net port 443: Connection refused\n\nNetwork policy denied: host not in allowlist",
            },
          ],
        },
        {
          kind: "text",
          text: "The network request was blocked — `internal-registry.corp.net` isn't in the agent's network allowlist. I'll skip the registry check and proceed with the local image.\n\nHere's a summary of what was done:\n\n1. **Created** `notifications` table with recipient, type, title, body, payload, read/dismissed flags\n2. **Generated** migration `0014_add_notifications_table.sql`\n3. **Implemented** tRPC router with `list`, `markRead`, and `dismiss` procedures\n4. **Tests** pass (4/4)\n5. **Pending** — composite index on `(recipient_id, created_at DESC)` awaiting approval",
        },
      ],
      streaming: false,
    },
    {
      id: "sc-11",
      role: "assistant",
      parts: [
        {
          kind: "tool",
          toolCallId: "tc-sc-running",
          title: "Run: mise run check",
          status: "running",
        },
        {
          kind: "text",
          text: "Running lint and type-check across all packages...",
        },
      ],
      streaming: true,
    },
  ],
};

export const MOCK_PENDING_PERMISSION = {
  toolCallId: "tc-terminal-1",
  sessionId: "sess-002",
  toolCall: {
    title:
      "Run: psql -c 'CREATE INDEX CONCURRENTLY idx_events_org_created ON events(org_id, created_at DESC)'",
    command:
      "psql -c 'CREATE INDEX CONCURRENTLY idx_events_org_created ON events(org_id, created_at DESC)'",
    kind: "shell" as const,
    risk: "medium" as const,
    reasoning:
      "Adding this index will improve query performance for the analytics endpoint by ~100x for orgs with >10k events. Using CONCURRENTLY to avoid locking the table during creation.",
    impact: [
      "Creates new index on production database",
      "CONCURRENTLY — no table lock, but takes longer",
      "Estimated size: ~180 MB for current dataset",
    ],
  },
  options: [
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
    {
      optionId: "allow-always",
      name: "Always allow shell commands",
      kind: "allow_always",
    },
    { optionId: "reject-once", name: "Reject", kind: "reject_once" },
  ],
};
