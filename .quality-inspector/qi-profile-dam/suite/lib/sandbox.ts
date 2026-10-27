/* UNIT_BOUNDARY_DESCRIPTION: The sandbox test people and test users of the quality-inspector
 * profile: the first (accounts github, slack) and the second (github2, slack2), picked by `who`,
 * the first when it is left out; the second is optional. Slack: post as a person, read the bot's
 * replies in a thread, and give a thread's link (threadLink) for a task that tells the agent where
 * to post. A test person's post may carry a bot_id (it comes through an app), so a reply is a bot
 * post by neither person; the reading person's id must resolve, the other's may fail (a token the
 * instance lacks or broke, whose person posts nothing to tell apart). GitHub:
 * sandboxPull finds the newest pull request of the sandbox repository whose title holds the
 * run's id, and closeSandboxPull closes it and deletes its branch (a branch already gone is no error) —
 * the cleanup a test calls last, after its last criterion, so a failed run keeps both; neither reads the repository's
 * files. githubSignIn finishes DAM's "Authorize with GitHub" on github.com as a sandbox test user
 * (the password, a TOTP code computed per RFC 6238 and never reused, the OAuth App's consent
 * when GitHub asks) and returns once the browser is back on DAM, so a test never names a
 * sandbox host. GitHub keeps a browser signed in and the sign-in's pages have no sign-out, so
 * each test user signs in in a browser of its own: the second from another account's session. The values come from the E2E_SANDBOX_* lines, which the inspector masks in
 * every run artefact; the install's GitHub OAuth App (overlay @sandbox:github), which both test
 * users sign in through, is on only while every E2E_SANDBOX_GITHUB_* line is filled.
 * connectSlackChannel finishes the open "Connect Slack channels" dialog: it adds the sandbox
 * channel by its ID in the channel picker and connects. The picker lists a channel only for a
 * DAM user whose Slack account is linked, and a user links it only with a slash command in
 * Slack, which no Slack API sends; so on an unlinked account it throws SlackNotLinked, which
 * the test reports as blocked by that limit, never as a product failure. */
import { createHmac } from 'node:crypto';

const env = process.env;

export type Who = 'first' | 'second';
const githubVar = (who: Who, name: string) => env[`E2E_SANDBOX_${who === 'second' ? 'GITHUB2' : 'GITHUB'}_${name}`] ?? '';
const humanToken = (who: Who) => (who === 'second' ? env.E2E_SANDBOX_SLACK2_HUMAN_TOKEN : env.E2E_SANDBOX_SLACK_HUMAN_TOKEN) ?? '';

export const sandbox = {
  slack: (who: Who = 'first') => !!(humanToken(who) && env.E2E_SANDBOX_SLACK_BOT_TOKEN && env.E2E_SANDBOX_SLACK_CHANNEL_ID),
  githubRepo: () => (env.E2E_SANDBOX_GITHUB_TOKEN ? JSON.parse(env.QI_PROFILE_CONFIG ?? '{}').sandbox_github_repo ?? '' : ''),
  githubUser: (who: Who = 'first') =>
    !!(githubVar(who, 'LOGIN') && githubVar(who, 'PASSWORD') && githubVar(who, 'TOTP_SECRET') &&
       env.E2E_SANDBOX_GITHUB_OAUTH_CLIENT_ID && env.E2E_SANDBOX_GITHUB_OAUTH_CLIENT_SECRET),
  githubLogin: (who: Who = 'first') => githubVar(who, 'LOGIN'),
  channelId: () => env.E2E_SANDBOX_SLACK_CHANNEL_ID ?? '',
};

async function slack(token: string | undefined, method: string, body: Record<string, string> = {}) {
  const r = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token ?? ''}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const j = (await r.json()) as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!j.ok) throw new Error(`slack ${method}: ${j.error ?? `HTTP ${r.status}`}`);
  return j;
}

export async function botUserId(): Promise<string> {
  return String((await slack(env.E2E_SANDBOX_SLACK_BOT_TOKEN, 'auth.test')).user_id);
}

export async function personSays(text: string, threadTs?: string, who: Who = 'first'): Promise<string> {
  const j = await slack(humanToken(who), 'chat.postMessage',
    { channel: sandbox.channelId(), text, ...(threadTs ? { thread_ts: threadTs } : {}) });
  return String(j.ts);
}

const personIds: Partial<Record<Who, string>> = {};
async function personUserIds(reader: Who): Promise<string[]> {
  for (const who of ['first', 'second'] as const) {
    if (personIds[who] || !humanToken(who)) continue;
    try {
      personIds[who] = String((await slack(humanToken(who), 'auth.test')).user_id);
    } catch (e) {
      if (who === reader) throw e;
    }
  }
  return Object.values(personIds);
}

export async function botReplies(ts: string, ms = 300_000, who: Who = 'first'): Promise<string[]> {
  const until = Date.now() + ms;
  for (;;) {
    const j = await slack(humanToken(who), 'conversations.replies', { channel: sandbox.channelId(), ts });
    const messages = (j.messages as { ts: string; text?: string; bot_id?: string; user?: string }[]) ?? [];
    const people = await personUserIds(who);
    const replies = messages.filter((m) => m.ts !== ts && m.bot_id && !people.includes(m.user ?? '')).map((m) => m.text ?? '');
    if (replies.length || Date.now() > until) return replies;
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

export async function threadLink(ts: string, who: Who = 'first'): Promise<string> {
  return String((await slack(humanToken(who), 'chat.getPermalink', { channel: sandbox.channelId(), message_ts: ts })).permalink);
}

async function github(method: string, path: string, body?: unknown, gone = false): Promise<unknown> {
  const repo = sandbox.githubRepo();
  if (!repo) throw new Error('the GitHub sandbox is not set (E2E_SANDBOX_GITHUB_TOKEN, profile.sandbox_github_repo)');
  const r = await fetch(`https://api.github.com/repos/${repo}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.E2E_SANDBOX_GITHUB_TOKEN ?? ''}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (gone && (r.status === 404 || r.status === 422)) return null;
  if (!r.ok) throw new Error(`github ${method} ${path.split('?')[0]}: HTTP ${r.status}`);
  return r.status === 204 ? null : r.json();
}

export type SandboxPull = { number: number; url: string; title: string; state: string; branch: string };

export async function sandboxPull(id: string): Promise<SandboxPull | null> {
  type P = { number: number; html_url: string; title: string; state: string; head: { ref: string } };
  const pulls = (await github('GET', 'pulls?state=all&sort=created&direction=desc&per_page=50')) as P[];
  const p = pulls.find((x) => x.title.includes(id));
  return p ? { number: p.number, url: p.html_url, title: p.title, state: p.state, branch: p.head.ref } : null;
}

export async function closeSandboxPull(p: SandboxPull): Promise<void> {
  if (p.state === 'open') await github('PATCH', `pulls/${p.number}`, { state: 'closed' });
  if (p.branch) await github('DELETE', `git/refs/heads/${p.branch.split('/').map(encodeURIComponent).join('/')}`, undefined, true);
}

function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase().replace(/[\s=-]/g, '')) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error('the GitHub test user\'s TOTP secret is not base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const lastCode: Partial<Record<Who, string>> = {};
async function freshCode(who: Who): Promise<string> {
  for (;;) {
    const left = 30_000 - (Date.now() % 30_000);
    const code = totp(githubVar(who, 'TOTP_SECRET'));
    if (left > 5_000 && code !== lastCode[who]) return (lastCode[who] = code);
    await new Promise((r) => setTimeout(r, left + 500));
  }
}

type Loc = {
  fill(v: string): Promise<void>;
  tap(): Promise<void>;
  isVisible(): Promise<boolean>;
  waitFor(o?: { state?: string; timeout?: number }): Promise<void>;
  first(): Loc;
};
type Scr = {
  getByLabel(t: string | RegExp): Loc;
  getByRole(r: string, n: string | RegExp): Loc;
  getByText(t: string | RegExp): Loc;
};
type Brw = { url(): Promise<string>; waitForURL(u: RegExp, o?: { timeout?: number }): Promise<void> };

const onGitHub = async (browser: Brw) => /^https:\/\/github\.com\//.test(await browser.url());

export async function githubSignIn(
  { screen, browser, who = 'first' }: { screen: Scr; browser: Brw; who?: Who },
  timeout = 60_000,
): Promise<void> {
  if (!sandbox.githubUser(who)) throw new Error(`the ${who} GitHub sandbox test user is not set (E2E_SANDBOX_GITHUB${who === 'second' ? '2' : ''}_*)`);
  const app = new RegExp('^' + (env.APP_URL ?? 'http://localhost:4444').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  await browser.waitForURL(/^https:\/\/github\.com\/(login|sessions?)\b/, { timeout }).catch(() => undefined);
  if (!(await onGitHub(browser))) return;
  const login = screen.getByLabel(/username or email/i).first();
  if (await login.isVisible()) {
    await login.fill(sandbox.githubLogin(who));
    await screen.getByLabel(/^password$/i).first().fill(githubVar(who, 'PASSWORD'));
    await screen.getByRole('button', /^sign in$/i).first().tap();
  }
  const code = screen.getByLabel(/authentication code|code from your authenticator/i).first();
  await code.waitFor({ state: 'visible', timeout });
  await code.fill(await freshCode(who));
  await browser.waitForURL(/^(?!https:\/\/github\.com\/sessions\/two-factor)/, { timeout: 10_000 }).catch(async () => {
    const verify = screen.getByRole('button', /^verify$/i).first();
    if (await verify.isVisible()) await verify.tap();
  });
  const authorize = screen.getByRole('button', /^authorize\b/i).first();
  if (await onGitHub(browser)) {
    await authorize.waitFor({ state: 'visible', timeout }).catch(() => undefined);
    for (let i = 0; i < 20 && (await onGitHub(browser)) && (await authorize.isVisible()); i++) {
      await authorize.tap().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  await browser.waitForURL(app, { timeout });
}

export class SlackNotLinked extends Error {
  constructor() {
    super(
      'blocked — the signed-in DAM account has no linked Slack account, so the channel picker lists no channel; ' +
        'a person links it only with /dam login or /dam bind typed in Slack, which a test cannot send',
    );
    this.name = 'SlackNotLinked';
  }
}

export async function connectSlackChannel({ screen }: { screen: Scr }, timeout = 30_000): Promise<void> {
  if (!sandbox.slack()) throw new Error('the Slack sandbox is not set (E2E_SANDBOX_SLACK_*)');
  const search = screen.getByRole('combobox', /channels/i).first();
  const unlinked = screen.getByText(/link your slack account/i).first();
  const until = Date.now() + timeout;
  for (;;) {
    if (await search.isVisible()) break;
    if (await unlinked.isVisible()) throw new SlackNotLinked();
    if (Date.now() > until) throw new Error('the "Connect Slack channels" dialog shows no channel picker');
    await new Promise((r) => setTimeout(r, 500));
  }
  await search.fill(sandbox.channelId());
  const add = screen.getByRole('option', /^add\b/i).first();
  await add.waitFor({ state: 'visible', timeout }).catch(async () => {
    const refused = screen.getByText(/aren't both in/i).first();
    throw new Error(
      (await refused.isVisible())
        ? 'the picker refuses the sandbox channel: the linked Slack person or the bot is not in it'
        : 'the picker offers no option for the sandbox channel',
    );
  });
  await add.tap();
  await screen.getByRole('button', /^connect$/i).first().tap();
}
