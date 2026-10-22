const env = process.env;

export const sandbox = {
  slack: () => !!(env.E2E_SANDBOX_SLACK_HUMAN_TOKEN && env.E2E_SANDBOX_SLACK_BOT_TOKEN && env.E2E_SANDBOX_SLACK_CHANNEL_ID),
  githubRepo: () => (env.E2E_SANDBOX_GITHUB_TOKEN ? JSON.parse(env.QI_PROFILE_CONFIG ?? '{}').sandbox_github_repo ?? '' : ''),
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
