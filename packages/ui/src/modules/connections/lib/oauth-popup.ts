const CHANNEL_NAME = "platform-oauth";
const POPUP_NAME = "platform-oauth";

export interface OAuthPopupResult {
  status: "success" | "error";
  message?: string;
  connectionId?: string;
}

// Open the OAuth provider's auth URL in a centered popup. Resolves when the
// api-server's /api/oauth/callback bounces back to the UI with a result —
// the SPA loaded inside the popup detects window.name === POPUP_NAME, posts
// the result to a BroadcastChannel, and closes itself. Keeping the auth flow
// out of the parent window means the From Scratch agent-creation modal (and
// any in-progress form state) survives the round-trip instead of being torn
// down by a full-window navigation.
export function openOAuthPopup(authUrl: string): Promise<OAuthPopupResult> {
  const width = 560;
  const height = 720;
  const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2);
  const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2);
  const popup = window.open(
    authUrl,
    POPUP_NAME,
    `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`,
  );
  if (!popup) {
    return Promise.reject(
      new Error("Popup was blocked — allow popups for this site and retry."),
    );
  }

  return new Promise((resolve, reject) => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    const closedPoll = window.setInterval(() => {
      if (popup.closed) {
        cleanup();
        reject(new Error("OAuth window closed before completion."));
      }
    }, 500);
    const cleanup = () => {
      channel.close();
      window.clearInterval(closedPoll);
    };
    channel.onmessage = (event) => {
      const data = event.data as OAuthPopupResult | undefined;
      if (!data || (data.status !== "success" && data.status !== "error"))
        return;
      cleanup();
      resolve(data);
    };
  });
}

// Called once at SPA bootstrap. If we're the OAuth popup window (window.name
// matches what openOAuthPopup set), forward the ?oauth=… result to the
// parent tab and close. Returns true if the page consumed the redirect and
// is shutting itself down — callers should skip rendering the SPA in that
// case so the user doesn't see a flash of UI before the window closes.
export function broadcastAndCloseIfOAuthPopup(): boolean {
  if (window.name !== POPUP_NAME) return false;
  const params = new URLSearchParams(window.location.search);
  const status = params.get("oauth");
  if (status !== "success" && status !== "error") return false;
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage({
    status,
    message: params.get("message") ?? undefined,
    connectionId: params.get("connection") ?? undefined,
  } satisfies OAuthPopupResult);
  channel.close();
  // One tick so the BroadcastChannel message flushes before teardown.
  window.setTimeout(() => window.close(), 50);
  return true;
}
