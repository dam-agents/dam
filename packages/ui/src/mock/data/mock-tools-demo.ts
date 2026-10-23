import type {
  ChangeSet,
  ChangeSetDiff,
  ChangeSetList,
} from "agent-runtime-api";

import type { MockChangesData } from "../mock-changes-card.js";
import type { MockBackgroundTask } from "./mock-background-tasks.js";

const now = Date.now();
const minutesAgo = (m: number) => new Date(now - m * 60_000).toISOString();

export const TOOLS_DEMO_TASKS: MockBackgroundTask[] = [
  {
    id: "bg-demo-1",
    command: "npm run build",
    startedAt: minutesAgo(3),
    processKey: "proc-npm-build-1",
  },
  {
    id: "bg-demo-2",
    command: "npm run test -- --watch",
    startedAt: minutesAgo(8),
    processKey: "proc-python-train-1",
  },
];

export const TOOLS_DEMO_BROWSER_URL = "http://localhost:3000";

export const TOOLS_DEMO_CHANGES: MockChangesData = {
  filesChanged: 4,
  additions: 120,
  deletions: 18,
  repo: "acme/web-app",
  branch: "fix/auth-redirect",
  prNumber: 847,
  prUrl: "https://github.com/acme/web-app/pull/847",
};

const REPO_PATH = "/home/user/acme-web-app";

const changeSet: ChangeSet = {
  path: REPO_PATH,
  repository: {
    id: "repo-acme-web-app",
    name: "acme/web-app",
    root: REPO_PATH,
  },
  branch: "fix/auth-redirect",
  baseRef: "main",
  stat: { files: 4, additions: 120, deletions: 18 },
  commitsAhead: 3,
  uncommitted: false,
  pullRequest: { number: 847, url: "https://github.com/acme/web-app/pull/847" },
  sessionEditedAt: minutesAgo(2),
  readError: null,
};

export const MOCK_CHANGE_SET_LIST: ChangeSetList = {
  changeSets: [changeSet],
};

export const MOCK_CHANGE_SET_DIFF: ChangeSetDiff = {
  path: REPO_PATH,
  compare: "base",
  baseRef: "main",
  truncated: false,
  files: [
    {
      path: "src/middleware/auth.ts",
      oldPath: null,
      status: "modified",
      additions: 45,
      deletions: 12,
      binary: false,
      uncommitted: false,
      patch: [
        "@@ -1,12 +1,45 @@",
        " import { NextRequest, NextResponse } from 'next/server';",
        " import { verify } from './jwt';",
        "+import { redirectToLogin } from './redirect';",
        " ",
        " export async function authMiddleware(req: NextRequest) {",
        "   const token = req.cookies.get('session')?.value;",
        "-  if (!token) return NextResponse.redirect('/login');",
        "+  if (!token) {",
        "+    return redirectToLogin(req, { reason: 'missing-token' });",
        "+  }",
        " ",
        "   try {",
        "     const payload = await verify(token);",
        "-    return NextResponse.next();",
        "+    if (payload.exp < Date.now() / 1000) {",
        "+      return redirectToLogin(req, { reason: 'expired' });",
        "+    }",
        "+    const headers = new Headers(req.headers);",
        "+    headers.set('x-user-id', payload.sub);",
        "+    return NextResponse.next({ headers });",
        "   } catch {",
        "-    return NextResponse.redirect('/login');",
        "+    return redirectToLogin(req, { reason: 'invalid' });",
        "   }",
        " }",
      ].join("\n"),
    },
    {
      path: "src/middleware/redirect.ts",
      oldPath: null,
      status: "added",
      additions: 38,
      deletions: 0,
      binary: false,
      uncommitted: false,
      patch: [
        "@@ -0,0 +1,38 @@",
        "+import { NextRequest, NextResponse } from 'next/server';",
        "+",
        "+type RedirectReason = 'missing-token' | 'expired' | 'invalid';",
        "+",
        "+export function redirectToLogin(",
        "+  req: NextRequest,",
        "+  opts: { reason: RedirectReason },",
        "+) {",
        "+  const url = req.nextUrl.clone();",
        "+  url.pathname = '/login';",
        "+  url.searchParams.set('from', req.nextUrl.pathname);",
        "+  url.searchParams.set('reason', opts.reason);",
        "+  return NextResponse.redirect(url);",
        "+}",
      ].join("\n"),
    },
    {
      path: "src/routes/auth.ts",
      oldPath: null,
      status: "modified",
      additions: 28,
      deletions: 6,
      binary: false,
      uncommitted: false,
      patch: [
        "@@ -10,6 +10,28 @@",
        " router.post('/login', async (req, res) => {",
        "-  const { email, password } = req.body;",
        "+  const { email, password, from } = req.body;",
        "   const user = await findUser(email);",
        "   if (!user || !await compare(password, user.hash)) {",
        "     return res.status(401).json({ error: 'Invalid credentials' });",
        "   }",
        "-  const token = sign({ sub: user.id });",
        "-  res.cookie('session', token);",
        "-  return res.json({ ok: true });",
        "+  const token = sign({ sub: user.id, email: user.email });",
        "+  res.cookie('session', token, {",
        "+    httpOnly: true,",
        "+    secure: process.env.NODE_ENV === 'production',",
        "+    sameSite: 'lax',",
        "+    maxAge: 60 * 60 * 24 * 7,",
        "+  });",
        "+  return res.json({ ok: true, redirect: from || '/' });",
        " });",
      ].join("\n"),
    },
    {
      path: "tests/middleware/auth.test.ts",
      oldPath: null,
      status: "modified",
      additions: 9,
      deletions: 0,
      binary: false,
      uncommitted: false,
      patch: [
        "@@ -25,0 +25,9 @@",
        "+test('redirects with reason on expired token', async () => {",
        "+  const req = mockRequest({ cookies: { session: EXPIRED_TOKEN } });",
        "+  const res = await authMiddleware(req);",
        "+  expect(res.status).toBe(307);",
        "+  const url = new URL(res.headers.get('location')!);",
        "+  expect(url.pathname).toBe('/login');",
        "+  expect(url.searchParams.get('reason')).toBe('expired');",
        "+  expect(url.searchParams.get('from')).toBe('/dashboard');",
        "+});",
      ].join("\n"),
    },
  ],
};

export const MOCK_EMPTY_CHANGE_SET_LIST: ChangeSetList = {
  changeSets: [],
};
