import type { BindMessenger } from "../components/channels/channel-bind-modal.js";

const KEY = "platform-bind-intent";

interface BindIntent {
  agentId: string;
  messengers: BindMessenger[];
}

export function offeredBindMessengers(
  selected: Record<BindMessenger, boolean>,
  available: Partial<Record<BindMessenger, boolean>> | undefined,
): BindMessenger[] {
  return (["slack", "telegram"] as const).filter(
    (m) => selected[m] && available?.[m],
  );
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
  if (intent?.agentId !== agentId) return null;
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  const messengers = (intent.messengers ?? []).filter(
    (m): m is BindMessenger => m === "slack" || m === "telegram",
  );
  return messengers.length > 0 ? messengers : null;
}
