import type { BindMessenger } from "../components/channels/channel-bind-modal.js";

const KEY = "platform-bind-intent";

interface BindIntent {
  agentId: string;
  messengers: BindMessenger[];
}

export function recordBindIntent(
  agentId: string,
  messengers: BindMessenger[],
): void {
  if (messengers.length === 0) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ agentId, messengers }));
  } catch {}
}

export function consumeBindIntent(agentId: string): BindMessenger[] | null {
  let intent: BindIntent;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    intent = JSON.parse(raw) as BindIntent;
  } catch {
    return null;
  }
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  if (intent?.agentId !== agentId) return null;
  const messengers = (intent.messengers ?? []).filter(
    (m): m is BindMessenger => m === "slack" || m === "telegram",
  );
  return messengers.length > 0 ? messengers : null;
}
