import { Command } from "commander";
import net from "node:net";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import WebSocket from "ws";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { TokenProvider } from "../../auth/index.js";
import type { InstanceService } from "../../instance/index.js";
import { createInstanceResolver } from "../../instance/index.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_INVALID_INPUT,
  EXIT_INSTANCE_RUNTIME_FAILURE,
} from "../../instance/commands/exit-codes.js";
import { editorKeyPath } from "../../instance/infrastructure/editor-keys.js";

export function buildEditorCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createInstanceService: (host: string) => InstanceService;
}): Command {
  return new Command("editor")
    .description(
      "[PROTOTYPE] Open a local SSH tunnel to an instance's in-pod editor (VSCode Remote-SSH)",
    )
    .argument("<instance>", "Instance name or id (created with --with-editor)")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--port <port>",
      "local TCP port to bind (default: random ephemeral)",
    )
    .action(
      async (
        ref: string,
        opts: { server?: string; port?: string },
      ): Promise<void> => {
        await runEditor(ref, opts, deps);
      },
    );
}

async function runEditor(
  ref: string,
  opts: { server?: string; port?: string },
  deps: {
    compatService: CompatService;
    configService: ConfigService;
    tokenProvider: TokenProvider;
    createInstanceService: (host: string) => InstanceService;
  },
): Promise<void> {
  const localPort = opts.port ? Number.parseInt(opts.port, 10) : 0;
  if (opts.port && (Number.isNaN(localPort) || localPort < 0)) {
    process.stderr.write(`error: invalid --port \`${opts.port}\`\n`);
    process.exit(EXIT_INSTANCE_INVALID_INPUT);
  }

  const host = await resolveActiveHost(deps, {
    flag: opts.server ? { server: opts.server } : undefined,
    exitCodes: {
      runtimeFailure: EXIT_INSTANCE_RUNTIME_FAILURE,
      belowFloor: EXIT_INSTANCE_BELOW_FLOOR,
    },
  });

  const tokRes = await deps.tokenProvider.getValidAccessToken(host);
  if (!tokRes.ok) {
    process.stderr.write(
      `error: not authenticated (${tokRes.error.kind}); run \`dam auth login\` first\n`,
    );
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }
  const token = tokRes.value;

  const svc = deps.createInstanceService(host);
  const resolver = createInstanceResolver({ instanceService: svc });
  const resolved = await resolver.resolve(ref);
  if (!resolved.ok) {
    process.stderr.write(
      `error: ${JSON.stringify(resolved.error)} for \`${ref}\`\n`,
    );
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }
  const instance = resolved.value;

  const keyPath = editorKeyPath(instance.name);
  if (!existsSync(keyPath)) {
    process.stderr.write(
      `error: editor key not found at ${keyPath}\nhint: create the instance with \`dam instance create ${instance.name} --template … --with-editor\`\n`,
    );
    process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
  }

  const proto = host.startsWith("https://") ? "wss:" : "ws:";
  const base = host.replace(/^https?:\/\//, "");
  const wsUrl = `${proto}//${base}/api/instances/${encodeURIComponent(instance.id)}/editor?token=${encodeURIComponent(token)}`;

  const server = net.createServer((conn) => {
    conn.pause();
    const ws = new WebSocket(wsUrl);
    let opened = false;
    const pending: Buffer[] = [];
    conn.on("data", (data) => {
      const buf = typeof data === "string" ? Buffer.from(data) : data;
      if (opened && ws.readyState === WebSocket.OPEN) ws.send(buf);
      else pending.push(buf);
    });
    conn.on("close", () => {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      )
        ws.close();
    });
    conn.on("error", () => {
      try {
        ws.close();
      } catch {}
    });
    ws.on("open", () => {
      opened = true;
      for (const b of pending) ws.send(b);
      pending.length = 0;
      conn.resume();
    });
    ws.on("message", (data) => {
      conn.write(data as Buffer);
    });
    ws.on("close", () => conn.end());
    ws.on("error", (e) => {
      process.stderr.write(`[editor] upstream error: ${e.message}\n`);
      try {
        conn.destroy();
      } catch {}
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(localPort, "127.0.0.1", () => resolve());
  });

  const boundPort = (server.address() as net.AddressInfo).port;
  const alias = `dam-editor-${instance.name}`;
  const sshConfigPath = writeSshConfig(alias, boundPort, keyPath);

  process.stdout.write(
    [
      `✓ Tunnel ready on 127.0.0.1:${boundPort}`,
      `  ssh config: ${sshConfigPath}`,
      `  attach VSCode:`,
      `    code --folder-uri 'vscode-remote://ssh-remote+${alias}/home/agent/work'`,
      `  one-time setup (if not done): add to your ~/.ssh/config:`,
      `    Include ${sshConfigPath}`,
      ``,
      `Press Ctrl+C to close the tunnel.`,
      ``,
    ].join("\n"),
  );

  await new Promise<void>(() => {});
}

function writeSshConfig(alias: string, port: number, keyPath: string): string {
  const dir =
    process.env.XDG_STATE_HOME && process.env.XDG_STATE_HOME.length > 0
      ? join(process.env.XDG_STATE_HOME, "dam", "editor-ssh")
      : join(homedir(), ".local", "state", "dam", "editor-ssh");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${alias}.conf`);
  const block = [
    `Host ${alias}`,
    `  HostName 127.0.0.1`,
    `  Port ${port}`,
    `  User agent`,
    `  IdentityFile ${keyPath}`,
    `  IdentitiesOnly yes`,
    `  StrictHostKeyChecking no`,
    `  UserKnownHostsFile /dev/null`,
    ``,
  ].join("\n");
  writeFileSync(path, block, { mode: 0o600 });
  return path;
}
