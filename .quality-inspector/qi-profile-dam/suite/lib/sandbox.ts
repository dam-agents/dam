/* UNIT_BOUNDARY_DESCRIPTION: The sandbox test person and test user of the quality-inspector
 * profile. Slack: post as the person and read the bot's replies in a thread. GitHub:
 * githubSignIn finishes DAM's "Connect with GitHub" on github.com as the sandbox test user
 * (the password, a TOTP code computed per RFC 6238 and never reused, the OAuth App's consent
 * when GitHub asks) and returns once the browser is back on DAM, so a test never names a
 * sandbox host. The values come from the E2E_SANDBOX_* lines, which the inspector masks in
 * every run artefact; the install's GitHub OAuth App (overlay @sandbox:github) is on only
 * while every E2E_SANDBOX_GITHUB_* line is filled. */
import { createHmac } from 'node:crypto';

const env = process.env;

export const sandbox = {
  slack: () => !!(env.E2E_SANDBOX_SLACK_HUMAN_TOKEN && env.E2E_SANDBOX_SLACK_BOT_TOKEN && env.E2E_SANDBOX_SLACK_CHANNEL_ID),
  githubRepo: () => (env.E2E_SANDBOX_GITHUB_TOKEN ? JSON.parse(env.QI_PROFILE_CONFIG ?? '{}').sandbox_github_repo ?? '' : ''),
  githubUser: () =>
    !!(env.E2E_SANDBOX_GITHUB_LOGIN && env.E2E_SANDBOX_GITHUB_PASSWORD && env.E2E_SANDBOX_GITHUB_TOTP_SECRET &&
       env.E2E_SANDBOX_GITHUB_OAUTH_CLIENT_ID && env.E2E_SANDBOX_GITHUB_OAUTH_CLIENT_SECRET),
  githubLogin: () => env.E2E_SANDBOX_GITHUB_LOGIN ?? '',
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

export async function personSays(text: string): Promise<string> {
  const j = await slack(env.E2E_SANDBOX_SLACK_HUMAN_TOKEN, 'chat.postMessage', { channel: sandbox.channelId(), text });
  return String(j.ts);
}

export async function botReplies(ts: string, ms = 300_000): Promise<string[]> {
  const until = Date.now() + ms;
  for (;;) {
    const j = await slack(env.E2E_SANDBOX_SLACK_HUMAN_TOKEN, 'conversations.replies', { channel: sandbox.channelId(), ts });
    const messages = (j.messages as { ts: string; text?: string; bot_id?: string }[]) ?? [];
    const replies = messages.filter((m) => m.ts !== ts && m.bot_id).map((m) => m.text ?? '');
    if (replies.length || Date.now() > until) return replies;
    await new Promise((r) => setTimeout(r, 10_000));
  }
}

function totp(secret: string, at = Date.now()): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secret.toUpperCase().replace(/[\s=-]/g, '')) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error('E2E_SANDBOX_GITHUB_TOTP_SECRET is not base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

let lastCode = '';
async function freshCode(): Promise<string> {
  for (;;) {
    const left = 30_000 - (Date.now() % 30_000);
    const code = totp(env.E2E_SANDBOX_GITHUB_TOTP_SECRET ?? '');
    if (left > 5_000 && code !== lastCode) return (lastCode = code);
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
type Scr = { getByLabel(t: string | RegExp): Loc; getByRole(r: string, n: string | RegExp): Loc };
type Brw = { url(): Promise<string>; waitForURL(u: RegExp, o?: { timeout?: number }): Promise<void> };

const onGitHub = async (browser: Brw) => /^https:\/\/github\.com\//.test(await browser.url());

export async function githubSignIn({ screen, browser }: { screen: Scr; browser: Brw }, timeout = 60_000): Promise<void> {
  if (!sandbox.githubUser()) throw new Error('the GitHub sandbox test user is not set (E2E_SANDBOX_GITHUB_*)');
  const app = new RegExp('^' + (env.APP_URL ?? 'http://localhost:4444').replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'));
  await browser.waitForURL(/^https:\/\/github\.com\/(login|sessions?)\b/, { timeout }).catch(() => undefined);
  if (!(await onGitHub(browser))) return;
  const login = screen.getByLabel(/username or email/i).first();
  if (await login.isVisible()) {
    await login.fill(sandbox.githubLogin());
    await screen.getByLabel(/^password$/i).first().fill(env.E2E_SANDBOX_GITHUB_PASSWORD ?? '');
    await screen.getByRole('button', /^sign in$/i).first().tap();
  }
  const code = screen.getByLabel(/authentication code|code from your authenticator/i).first();
  await code.waitFor({ state: 'visible', timeout });
  await code.fill(await freshCode());
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
