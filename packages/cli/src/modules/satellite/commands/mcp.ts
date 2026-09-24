import { Command } from "commander";
import { DEFAULT_MAX_CONCURRENT } from "api-server-api";
import {
  createMcpBackend,
  type McpServerSpec,
} from "../services/mcp-backend.js";
import {
  connectOptions,
  fail,
  serve,
  type CommonConnectOpts,
  type ConnectDeps,
} from "./shared.js";

interface Opts extends CommonConnectOpts {
  cwd?: string;
  url?: string;
  header: string[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where a `--url` points. A bare host:port is the
 * common case for a server already listening on this machine or the LAN, and
 * `/mcp` is the Streamable HTTP endpoint such servers conventionally mount, so
 * that is filled in; anything with a scheme is taken exactly as written.
 */
export function parseServerUrl(value: string): URL | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `http://${value}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (withScheme !== value && url.pathname === "/") url.pathname = "/mcp";
  return url;
}

function parseHeaders(lines: string[]): Record<string, string> | string {
  const headers: Record<string, string> = {};
  for (const line of lines) {
    const colon = line.indexOf(":");
    if (colon <= 0) return `--header "${line}" is not "Name: value"`;
    headers[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return headers;
}

function serverSpec(command: string[], opts: Opts): McpServerSpec | string {
  if (opts.url !== undefined) {
    if (command.length > 0)
      return "pass either a command to start or --url, not both";
    if (opts.cwd !== undefined)
      return "--cwd applies to a started server, not one reached by --url";
    const url = parseServerUrl(opts.url);
    if (url === null) return `--url "${opts.url}" is not an http(s) URL`;
    const headers = parseHeaders(opts.header);
    if (typeof headers === "string") return headers;
    return { kind: "url", url, headers };
  }
  if (command.length === 0)
    return "name the MCP server to start, or pass --url for one already running";
  if (opts.header.length > 0)
    return "--header applies to a server reached by --url";
  return {
    kind: "stdio",
    command: command[0]!,
    args: command.slice(1),
    ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
  };
}

export function buildMcpCommand(deps: ConnectDeps): Command {
  return connectOptions(
    new Command("mcp")
      .description(
        "Expose an MCP server on this machine — started here, or already running — offering its tools to an agent",
      )
      .argument("[command...]", "the stdio MCP server to start"),
  )
    .option("--cwd <dir>", "working directory for the started MCP server")
    .option(
      "--url <url>",
      "reach an MCP server already listening, e.g. localhost:8080 or https://host/mcp",
    )
    .option(
      "--header <header>",
      'HTTP header sent to the --url server, e.g. "Authorization: Bearer …" (repeatable)',
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .addHelpText(
      "after",
      "\nThe server's tools are offered verbatim — the platform never reads inside\n" +
        "their schemas, and the server decides what each call may do. A started\n" +
        "server inherits this shell's environment.\n\n" +
        "  dam satellite mcp --name build-farm -- npx -y @acme/build-mcp\n" +
        "  dam satellite mcp --name build-farm --url localhost:8080\n\n" +
        "A --url without a scheme or path means http://HOST:PORT/mcp. Streamable\n" +
        "HTTP is tried first, then SSE.\n\n" +
        "First interrupt drains, second kills running jobs.\n",
    )
    .action(async (command: string[], opts: Opts) => {
      const spec = serverSpec(command, opts);
      if (typeof spec === "string") return fail(spec);

      let backend;
      try {
        backend = await createMcpBackend(spec);
      } catch (err) {
        return fail(
          spec.kind === "url"
            ? `could not reach the MCP server at ${spec.url.href}: ${String(err)}`
            : `could not start the MCP server: ${String(err)}`,
        );
      }
      if (backend.tools.length === 0) {
        await backend.close().catch(() => {});
        return fail("that MCP server lists no tools — nothing to expose");
      }

      return serve(
        deps,
        opts,
        backend,
        {
          name: opts.name!,
          ...(opts.description === undefined
            ? {}
            : { description: opts.description }),
          maxConcurrent: opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
        },
        spec.kind === "url" ? [`forwarding to ${spec.url.href}`] : [],
      );
    });
}
