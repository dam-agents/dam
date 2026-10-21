import http from "node:http";
import net from "node:net";
import type { Duplex } from "node:stream";

export const FORWARD_PREFIX = "/api/environment/forward/";
export const DECLARED_PORTS_HEADER = "x-platform-environment-ports";

// UNIT_BOUNDARY_DESCRIPTION: the ports the runtime serves on its own loopback, which an Environment can never declare as an endpoint: the runtime itself, its model router and the browser display.
const DISPLAY_PORT = 5999;

export interface EnvironmentForward {
  handleRequest(req: http.IncomingMessage, res: http.ServerResponse): boolean;
  handleUpgrade(
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): boolean;
}

interface Target {
  port: number;
  path: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The runtime's half of an Environment endpoint's
 * address. On an Environment only, it relays HTTP and WebSocket from
 * `/api/environment/forward/<port>/<path>` to that port on the machine's own
 * loopback, and to nothing else: never another host, and never one of the
 * runtime's own ports. The api-server names the endpoint ports the
 * Environment declared on every request; a port it did not name is refused,
 * so an app on an undeclared port stays private. Only the api-server and the
 * controller reach the runtime's port, so the header is theirs to set.
 */
export function createEnvironmentForward(opts: {
  ownPorts: number[];
}): EnvironmentForward {
  const reserved = new Set([...opts.ownPorts, DISPLAY_PORT]);

  function target(
    req: http.IncomingMessage,
  ): Target | { refuse: string } | null {
    const url = req.url ?? "";
    if (!url.startsWith(FORWARD_PREFIX)) return null;
    const rest = url.slice(FORWARD_PREFIX.length);
    const slash = rest.indexOf("/");
    const portText = slash === -1 ? rest : rest.slice(0, slash);
    const port = /^\d{1,5}$/.test(portText) ? Number(portText) : NaN;
    if (!(port >= 1 && port <= 65535)) return { refuse: "not a port" };
    if (reserved.has(port))
      return { refuse: `port ${port} is the runtime's own` };
    const declared = String(req.headers[DECLARED_PORTS_HEADER] ?? "")
      .split(",")
      .map((p) => Number(p.trim()));
    if (!declared.includes(port))
      return { refuse: `port ${port} is not an endpoint of this Environment` };
    return { port, path: slash === -1 ? "/" : rest.slice(slash) };
  }

  function forwardedHeaders(req: http.IncomingMessage, port: number) {
    const headers = { ...req.headers };
    delete headers[DECLARED_PORTS_HEADER];
    headers.host = `127.0.0.1:${port}`;
    return headers;
  }

  return {
    handleRequest(req, res) {
      const t = target(req);
      if (t === null) return false;
      if ("refuse" in t) {
        res.writeHead(403, { "Content-Type": "text/plain" }).end(t.refuse);
        return true;
      }
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: t.port,
          method: req.method,
          path: t.path,
          headers: forwardedHeaders(req, t.port),
        },
        (answer) => {
          res.writeHead(answer.statusCode ?? 502, answer.rawHeaders);
          answer.pipe(res);
        },
      );
      upstream.on("error", (e) => {
        if (!res.headersSent)
          res
            .writeHead(502, { "Content-Type": "text/plain" })
            .end(`nothing answers on port ${t.port}: ${e.message}`);
        else res.destroy();
      });
      req.pipe(upstream);
      return true;
    },

    handleUpgrade(req, socket, head) {
      const t = target(req);
      if (t === null) return false;
      if ("refuse" in t) {
        socket.end(
          `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\n${t.refuse}`,
        );
        return true;
      }
      const upstream = net.connect(t.port, "127.0.0.1", () => {
        const headers = forwardedHeaders(req, t.port);
        const lines = [`${req.method} ${t.path} HTTP/1.1`];
        for (const [name, value] of Object.entries(headers)) {
          for (const v of Array.isArray(value) ? value : [value])
            if (v !== undefined) lines.push(`${name}: ${v}`);
        }
        upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
        if (head.length > 0) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
      });
      const close = () => {
        upstream.destroy();
        socket.destroy();
      };
      upstream.on("error", () => {
        if (socket.writable) socket.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        close();
      });
      socket.on("error", close);
      socket.on("close", () => upstream.destroy());
      return true;
    },
  };
}
