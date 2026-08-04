import type { Page } from "@playwright/test";

/**
 * Capture every WebSocket the page opens so a spec can sever them later.
 * Must run before the page first navigates (init scripts apply per document).
 *
 * Exists because `context.setOffline(true)` only emulates offline for NEW
 * requests in Chromium — an already-established WebSocket stays open, so the
 * app's close handler (the unit the disconnect spec targets) never fires.
 */
export async function trackWebSockets(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const sockets: WebSocket[] = [];
    (window as unknown as { __e2eSockets: WebSocket[] }).__e2eSockets = sockets;
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    } as typeof WebSocket;
  });
}

/**
 * Close every WebSocket the page has opened. Fires the app's `close` handler
 * locally and detaches the channel server-side — the runtime then discards
 * that channel's queued prompts, which is the real loss the disconnect spec
 * asserts on. The app is free to reconnect on its own backoff afterwards.
 */
export async function dropWebSockets(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sockets =
      (window as unknown as { __e2eSockets?: WebSocket[] }).__e2eSockets ?? [];
    for (const ws of sockets) ws.close();
  });
}
