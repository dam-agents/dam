/**
 * Static-build fetch interceptor — replaces MSW for self-contained HTML prototypes.
 * Uses MSW handler.run() directly so handler logic stays identical to dev mode,
 * but bypasses the service worker so it works from file:// or any static host.
 */
import { handlers } from "./handlers.js";

interface MockWorker {
  start: (opts?: unknown) => Promise<void>;
}

const FAKE_ORIGIN = "http://localhost";

export const worker: MockWorker = {
  async start() {
    const baseUrl =
      window.location.protocol === "file:"
        ? FAKE_ORIGIN
        : window.location.origin;

    window.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ): Promise<Response> => {
      // Normalize the request to always have an absolute URL
      let url: string;
      if (typeof input === "string") {
        url = input.startsWith("/") ? baseUrl + input : input;
      } else if (input instanceof URL) {
        url = input.href;
      } else {
        url = input.url;
      }

      const request = new Request(url, init);

      for (const handler of handlers) {
        try {
          const result = await (handler as any).run({
            request: request.clone(),
            resolutionContext: { baseUrl },
          });
          if (result?.response) {
            return result.response;
          }
        } catch {
          // Handler didn't match — continue to next
        }
      }

      // No handler matched — return empty JSON to prevent network errors
      console.warn(
        "[prototype] unhandled fetch:",
        request.method,
        new URL(request.url).pathname,
      );
      return new Response(JSON.stringify(null), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };
  },
};
