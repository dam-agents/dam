import type { Page } from "@playwright/test";

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

export async function dropWebSockets(page: Page): Promise<void> {
  await page.evaluate(() => {
    const sockets =
      (window as unknown as { __e2eSockets?: WebSocket[] }).__e2eSockets ?? [];
    for (const ws of sockets) ws.close();
  });
}
