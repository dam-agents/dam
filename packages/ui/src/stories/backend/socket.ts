/** In-browser stand-in for every WebSocket the UI opens. The real app code
 *  (api.ts, agent-trpc.ts, acp.ts) runs unchanged; only the transport is fake. */

export interface FakeServer {
  /** Called once the socket is open; `send` pushes a frame to the client. */
  onOpen?(send: (frame: string) => void): void;
  onMessage(frame: string, send: (frame: string) => void): void;
}

type Route = (url: URL) => FakeServer | null;

const routes: Route[] = [];

export function routeSocket(route: Route) {
  routes.push(route);
}

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readonly url: string;
  readyState = 0;
  protocol = "";
  extensions = "";
  binaryType: BinaryType = "blob";
  bufferedAmount = 0;
  onopen: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  private server: FakeServer | null;

  constructor(url: string | URL) {
    super();
    this.url = String(url);
    const parsed = new URL(this.url, location.href);
    this.server = routes.map((r) => r(parsed)).find((s) => s) ?? null;
    if (!this.server) console.warn("[storybook] unrouted WebSocket", this.url);
    setTimeout(() => {
      if (!this.server) {
        this.fire("error", new Event("error"));
        this.close(1006);
        return;
      }
      this.readyState = 1;
      this.fire("open", new Event("open"));
      this.server.onOpen?.(this.push);
    }, 0);
  }

  private push = (frame: string) => {
    if (this.readyState !== 1) return;
    setTimeout(
      () => this.fire("message", new MessageEvent("message", { data: frame })),
      0,
    );
  };

  send(data: string) {
    if (this.readyState !== 1) return;
    this.server?.onMessage(data, this.push);
  }

  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    this.fire("close", new CloseEvent("close", { code, reason }));
  }

  private fire(type: string, event: Event) {
    const handler = this[`on${type}` as "onopen"];
    (handler as ((e: Event) => void) | null)?.call(this, event);
    this.dispatchEvent(event);
  }
}

export function installFakeWebSocket() {
  window.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
}
