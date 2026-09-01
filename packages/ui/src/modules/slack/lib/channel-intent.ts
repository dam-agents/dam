type ChannelKind = "slack" | "telegram";

const STORAGE_PREFIX = "platform-channel-intent-";

function keyFor(kind: ChannelKind): string {
  return `${STORAGE_PREFIX}${kind}`;
}

export function markChannelIntent(agentId: string, kind: ChannelKind): void {
  try {
    localStorage.setItem(keyFor(kind), agentId);
  } catch {
    /* quota / private mode */
  }
}

export function consumeChannelIntent(kind: ChannelKind): string | null {
  try {
    const val = localStorage.getItem(keyFor(kind));
    if (val) localStorage.removeItem(keyFor(kind));
    return val;
  } catch {
    return null;
  }
}

export function hasChannelIntent(
  agentId: string,
  kind: ChannelKind,
): boolean {
  try {
    return localStorage.getItem(keyFor(kind)) === agentId;
  } catch {
    return false;
  }
}
