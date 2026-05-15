import type { TerminalStrategy } from "api-server-api";
import { Command } from "commander";
import { SERVER_ENV_VAR } from "../../cli/index.js";
import type { ChatError, ChatService } from "../services/chat-service.js";

export function buildChatCommand(deps: { chatService: ChatService }): Command {
  return new Command("chat")
    .description("Connect your terminal to an agent's interactive TUI")
    .argument("<instance>", "instance name or ID")
    .option("--server <url>", "override the configured server URL")
    .option("-c, --continue", "continue the most recent terminal session")
    .option("-r, --resume <session-id>", "resume a specific session by ID")
    .option("--reset", "kill existing PTY and start a fresh terminal")
    .action(async (instanceRef: string, opts: { server?: string; continue?: boolean; resume?: string; reset?: boolean }) => {
      const strategy: TerminalStrategy = opts.resume
        ? { kind: "resume", sessionId: opts.resume }
        : opts.continue ? { kind: "continue" } : { kind: "new" };

      const result = await deps.chatService.run({
        instanceRef, serverFlag: opts.server, strategy, reset: opts.reset,
      });

      if (!result.ok) {
        printError(result.error);
        process.exit(exitCodeFor(result.error));
      }

      const { bridge, sessionId } = result.value;
      const resume = `\x1b[32mdam chat ${instanceRef} --resume ${sessionId}\x1b[0m`;
      const status = bridge.kind === "exited"
        ? `\x1b[33mSession ended\x1b[0m \x1b[2mProcess exited with code ${bridge.code}\x1b[0m`
        : `\x1b[33mDisconnected\x1b[0m \x1b[2m${bridge.reason}\x1b[0m`;
      process.stderr.write(`\x1b[2J\x1b[H${status}\n\nResume this session with: ${resume}\n`);
      process.exit(bridge.kind === "exited" ? bridge.code : 1);
    });
}

export function exitCodeFor(e: ChatError): number {
  switch (e.kind) {
    case "below-floor": return 3;
    case "not-found": case "ambiguous": return 5;
    case "not-a-tty": case "no-terminal-session": case "multiple-terminal-sessions":
    case "session-not-found": case "mode-switch-declined": return 2;
    default: return 1;
  }
}

export function printError(e: ChatError): void {
  const w = (msg: string) => process.stderr.write(`error: ${msg}\n`);
  switch (e.kind) {
    case "no-server": w(`no server configured; run "dam config set server <url>" or set ${SERVER_ENV_VAR}`); return;
    case "malformed-config": w(e.reason); return;
    case "below-floor": w(`CLI ${e.localCli} is below the server's minimum required version ${e.serverMinClient}; upgrade and retry`); return;
    case "not-found": w(e.via === "id" ? `no instance with id '${e.ref}'` : `no instance named '${e.ref}'`); return;
    case "ambiguous":
      w(`multiple instances named '${e.ref}':`);
      for (const m of e.matches) process.stderr.write(`  ${m.id}\n`);
      process.stderr.write("specify by id instead\n");
      return;
    case "auth-required": w(`not authenticated: ${e.reason}\n       run "dam auth login" first`); return;
    case "transport": w(`cannot reach server: ${e.reason}`); return;
    case "not-a-tty": w("dam chat requires an interactive terminal (TTY)"); return;
    case "session-failed": w(`session error: ${e.reason}`); return;
    case "no-terminal-session": w("no terminal session to continue; start one with: dam chat <instance>"); return;
    case "multiple-terminal-sessions":
      w("multiple terminal sessions found; specify one with --resume:");
      for (const id of e.sessionIds) process.stderr.write(`  ${id}\n`);
      return;
    case "session-not-found": w(`session '${e.sessionId}' not found`); return;
    case "mode-switch-declined": return;
  }
}
