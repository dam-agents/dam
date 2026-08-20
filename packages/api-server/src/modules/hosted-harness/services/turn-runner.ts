import { generateText, tool, type ToolSet } from "ai";
import {
  buildTurnContext,
  type ContextMessage,
  type ToolCallPayload,
  type TurnEventKind,
} from "../domain/events.js";
import { toModelMessages } from "../domain/model-messages.js";
import {
  hostedSystemPrompt,
  hostedToolDescriptions,
  hostedToolSchemas,
  type HostedToolName,
} from "../domain/tools.js";
import {
  isAgentStoppedError,
  isAgentWakeTimeoutError,
} from "../../agents/index.js";
import type { TurnLogRepository } from "./../infrastructure/turn-log-repository.js";
import type { HostedPodClient } from "../infrastructure/pod-client.js";
import type { ModelResolver } from "../infrastructure/model-resolver.js";

const MAX_STEPS = 100;
const COMPACT_AT_TOKENS = 160_000;

export interface TurnRunnerAgentInfo {
  id: string;
  name: string;
  workDir: string;
}

export interface TurnRunnerDeps {
  repo: TurnLogRepository;
  resolveModel: ModelResolver;
  podClient(agentId: string): HostedPodClient;
  getAgent(agentId: string): Promise<TurnRunnerAgentInfo | null>;
  ensurePodReady(agentId: string): Promise<void>;
  log: (msg: string) => void;
}

export interface TurnRunner {
  runTurn(turnId: string): Promise<void>;
}

class FenceConflict extends Error {
  constructor() {
    super("turn event fence conflict — another replica owns this turn");
  }
}

class WakeRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export function createTurnRunner(deps: TurnRunnerDeps): TurnRunner {
  async function executeTool(
    agentId: string,
    toolName: HostedToolName,
    input: unknown,
    shell: { cwd?: string },
  ): Promise<{ output: string; isError: boolean }> {
    try {
      await deps.ensurePodReady(agentId);
    } catch (err) {
      if (isAgentStoppedError(err)) {
        throw new WakeRefused("the user stopped this sandbox");
      }
      if (isAgentWakeTimeoutError(err) && err.failure.kind === "over-budget") {
        throw new WakeRefused(
          "the sandbox cannot start because the owner's compute budget is exhausted",
        );
      }
      throw err;
    }
    const pod = deps.podClient(agentId);
    try {
      switch (toolName) {
        case "bash": {
          const p = hostedToolSchemas.bash.parse(input);
          if (p.runInBackground) {
            const r = await pod.execStart({
              command: p.command,
              cwd: shell.cwd,
            });
            return {
              output: `Started in background. backgroundId: ${r.backgroundId}`,
              isError: false,
            };
          }
          const r = await pod.execRun({
            command: p.command,
            timeoutMs: p.timeoutMs,
            cwd: shell.cwd,
          });
          shell.cwd = r.cwd;
          const status = r.timedOut
            ? "\n[timed out and was killed]"
            : r.exitCode !== 0
              ? `\n[exit code ${r.exitCode}]`
              : "";
          return {
            output: (r.output || "(no output)") + status,
            isError: r.timedOut || r.exitCode !== 0,
          };
        }
        case "bash_tail": {
          const p = hostedToolSchemas.bash_tail.parse(input);
          if (p.kill) {
            const r = await pod.execKill(p.backgroundId);
            return {
              output: r.killed ? "killed" : "not running",
              isError: false,
            };
          }
          const r = await pod.execTail({
            backgroundId: p.backgroundId,
            offset: p.offset,
          });
          return {
            output: `${r.output || "(no new output)"}\n[running: ${r.running}${r.exitCode != null ? `, exit code ${r.exitCode}` : ""}, nextOffset: ${r.nextOffset}]`,
            isError: false,
          };
        }
        case "read": {
          const p = hostedToolSchemas.read.parse(input);
          const r = await pod.readFile(p.path);
          return { output: r.content, isError: false };
        }
        case "write": {
          const p = hostedToolSchemas.write.parse(input);
          try {
            await pod.writeFile(p.path, p.content);
          } catch {
            await pod.createFile(p.path, p.content);
          }
          return { output: `wrote ${p.path}`, isError: false };
        }
        case "edit": {
          const p = hostedToolSchemas.edit.parse(input);
          const r = await pod.readFile(p.path);
          const first = r.content.indexOf(p.oldString);
          if (first === -1)
            return { output: "oldString not found in file", isError: true };
          if (r.content.indexOf(p.oldString, first + 1) !== -1)
            return { output: "oldString is not unique in file", isError: true };
          await pod.writeFile(
            p.path,
            r.content.replace(p.oldString, p.newString),
          );
          return { output: `edited ${p.path}`, isError: false };
        }
        case "glob": {
          const p = hostedToolSchemas.glob.parse(input);
          const r = await pod.execRun({
            command: `fd --glob ${shellQuote(p.pattern)} ${p.cwd ? shellQuote(p.cwd) : "."} 2>/dev/null | head -200 || find ${p.cwd ? shellQuote(p.cwd) : "."} -path ${shellQuote(`*${p.pattern.replaceAll("**", "*")}`)} | head -200`,
            cwd: shell.cwd,
          });
          return { output: r.output || "(no matches)", isError: false };
        }
        case "skill": {
          const p = hostedToolSchemas.skill.parse(input);
          if (!p.name) {
            const skills = await pod.listSkills();
            return {
              output: skills.length
                ? skills.map((s) => `${s.name}: ${s.description}`).join("\n")
                : "(no skills installed)",
              isError: false,
            };
          }
          const r = await pod.readSkill(p.name);
          return {
            output: r.files
              .map((f) => `--- ${f.path} ---\n${f.content}`)
              .join("\n\n"),
            isError: false,
          };
        }
        case "grep": {
          const p = hostedToolSchemas.grep.parse(input);
          const target = p.path ? shellQuote(p.path) : ".";
          const globArg = p.glob ? ` --glob ${shellQuote(p.glob)}` : "";
          const r = await pod.execRun({
            command: `rg -n${globArg} ${shellQuote(p.pattern)} ${target} 2>/dev/null | head -200 || grep -rn ${shellQuote(p.pattern)} ${target} | head -200`,
            cwd: shell.cwd,
          });
          return { output: r.output || "(no matches)", isError: false };
        }
      }
    } catch (err) {
      return {
        output: `tool failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  return {
    async runTurn(turnId): Promise<void> {
      const turn = await deps.repo.getTurn(turnId);
      if (!turn || turn.status !== "running") return;
      const session = await deps.repo.getSession(turn.sessionId);
      if (!session) {
        await deps.repo.endTurn(turnId, "error");
        return;
      }
      const agent = await deps.getAgent(session.agentId);
      if (!agent) {
        await deps.repo.endTurn(turnId, "error");
        return;
      }

      const turnEvents = await deps.repo.listTurnEvents(turnId);
      let seq = (turnEvents.at(-1)?.seq ?? -1) + 1;
      const append = async (kind: TurnEventKind, payload: unknown) => {
        const result = await deps.repo.appendEvent({
          sessionId: session.id,
          turnId,
          seq,
          kind,
          payload,
        });
        if (result === "conflict") throw new FenceConflict();
        seq += 1;
      };

      const allEvents = await deps.repo.listSessionEvents(session.id);
      const ctx = buildTurnContext(allEvents);
      const messages: ContextMessage[] = [...ctx.messages];
      const shell: { cwd?: string } = {};

      for (const dangling of ctx.danglingToolCalls as ToolCallPayload[]) {
        const payload = {
          callId: dangling.callId,
          output: "interrupted — the platform restarted while this tool ran",
          isError: true,
          interrupted: true,
        };
        await append("tool-result", payload);
        messages.push({
          role: "tool-result",
          callId: dangling.callId,
          tool: dangling.tool,
          output: payload.output,
          isError: true,
        });
      }

      const { model } = await deps.resolveModel(session.agentId);
      const tools: ToolSet = {
        bash: tool({
          description: hostedToolDescriptions.bash,
          inputSchema: hostedToolSchemas.bash,
        }),
        bash_tail: tool({
          description: hostedToolDescriptions.bash_tail,
          inputSchema: hostedToolSchemas.bash_tail,
        }),
        read: tool({
          description: hostedToolDescriptions.read,
          inputSchema: hostedToolSchemas.read,
        }),
        write: tool({
          description: hostedToolDescriptions.write,
          inputSchema: hostedToolSchemas.write,
        }),
        edit: tool({
          description: hostedToolDescriptions.edit,
          inputSchema: hostedToolSchemas.edit,
        }),
        glob: tool({
          description: hostedToolDescriptions.glob,
          inputSchema: hostedToolSchemas.glob,
        }),
        grep: tool({
          description: hostedToolDescriptions.grep,
          inputSchema: hostedToolSchemas.grep,
        }),
        skill: tool({
          description: hostedToolDescriptions.skill,
          inputSchema: hostedToolSchemas.skill,
        }),
      };

      const estimateTokens = () =>
        Math.ceil(JSON.stringify(messages).length / 4);
      let lastInputTokens = estimateTokens();

      const compact = async () => {
        const summary = await generateText({
          model,
          system:
            "You compact a coding-agent conversation. Write a dense summary that preserves: the user's goals, decisions made, current in-flight task state, key file paths, and anything needed to continue the work seamlessly.",
          messages: [
            ...toModelMessages(messages),
            {
              role: "user",
              content:
                "Summarize the conversation so far for context compaction. Reply with only the summary.",
            },
          ],
        });
        if (!summary.text) throw new Error("compaction produced no summary");
        const coversThroughEventId = await deps.repo.latestSessionEventId(
          session.id,
        );
        await append("compaction", {
          summary: summary.text,
          coversThroughEventId,
        });
        messages.length = 0;
        messages.push({
          role: "user",
          text: `[Conversation summary — earlier history was compacted]\n${summary.text}`,
        });
        lastInputTokens = estimateTokens();
        deps.log(
          `[turn ${turnId}] compacted context through event ${coversThroughEventId}`,
        );
      };

      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const live = await deps.repo.getTurn(turnId);
          if (!live || live.status !== "running") return;
          if (lastInputTokens > COMPACT_AT_TOKENS) await compact();
          const result = await generateText({
            model,
            system: hostedSystemPrompt({
              agentName: agent.name,
              workDir: agent.workDir,
            }),
            messages: toModelMessages(messages),
            tools,
          });
          lastInputTokens = result.usage?.inputTokens ?? estimateTokens();

          if (result.text) {
            await append("assistant-message", { text: result.text });
            messages.push({ role: "assistant", text: result.text });
          }

          const calls = result.toolCalls ?? [];
          if (calls.length === 0) {
            await append("turn-end", { status: "done" });
            await deps.repo.endTurn(turnId, "done");
            return;
          }

          for (const call of calls) {
            await append("tool-call", {
              callId: call.toolCallId,
              tool: call.toolName,
              args: call.input,
            });
            messages.push({
              role: "assistant-tool-call",
              callId: call.toolCallId,
              tool: call.toolName,
              args: call.input,
            });
            let toolOutcome: { output: string; isError: boolean };
            try {
              toolOutcome = await executeTool(
                session.agentId,
                call.toolName as HostedToolName,
                call.input,
                shell,
              );
            } catch (err) {
              if (!(err instanceof WakeRefused)) throw err;
              await append("tool-result", {
                callId: call.toolCallId,
                output: `tool unavailable: ${err.reason}`,
                isError: true,
              });
              messages.push({
                role: "tool-result",
                callId: call.toolCallId,
                tool: call.toolName,
                output: `tool unavailable: ${err.reason}`,
                isError: true,
              });
              const closing = await generateText({
                model,
                system: [
                  hostedSystemPrompt({
                    agentName: agent.name,
                    workDir: agent.workDir,
                  }),
                  `IMPORTANT: You no longer have tool access because ${err.reason}. Write one final message to the user: explain why you had to stop, summarize what you did and what remains to be done. Do not call tools.`,
                ].join("\n\n"),
                messages: toModelMessages(messages),
              });
              await append("assistant-message", {
                text: closing.text || `I had to stop: ${err.reason}.`,
              });
              await append("turn-end", {
                status: "interrupted",
                reason: err.reason,
              });
              await deps.repo.endTurn(turnId, "interrupted");
              return;
            }
            const { output, isError } = toolOutcome;
            await append("tool-result", {
              callId: call.toolCallId,
              output,
              isError,
            });
            messages.push({
              role: "tool-result",
              callId: call.toolCallId,
              tool: call.toolName,
              output,
              isError,
            });
          }
          await deps.repo.heartbeatTurn(turnId);
        }
        await append("turn-end", {
          status: "error",
          reason: `turn exceeded ${MAX_STEPS} steps`,
        });
        await deps.repo.endTurn(turnId, "error");
      } catch (err) {
        if (err instanceof FenceConflict) {
          deps.log(`[turn ${turnId}] fence conflict — yielding`);
          return;
        }
        deps.log(
          `[turn ${turnId}] failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        try {
          await append("turn-end", {
            status: "error",
            reason: err instanceof Error ? err.message : "unknown error",
          });
        } catch {
          void 0;
        }
        await deps.repo.endTurn(turnId, "error");
        throw err;
      }
    },
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
