import { z } from "zod";

export const hostedToolSchemas = {
  bash: z.object({
    command: z.string().min(1).describe("The shell command to run"),
    timeoutMs: z
      .number()
      .int()
      .min(1000)
      .max(600_000)
      .optional()
      .describe("Timeout in milliseconds (default 120000, max 600000)"),
    runInBackground: z
      .boolean()
      .optional()
      .describe("Run detached; returns a backgroundId to poll with bash_tail"),
  }),
  bash_tail: z.object({
    backgroundId: z.string().describe("Id returned by a background bash call"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Byte offset to continue reading from"),
    kill: z.boolean().optional().describe("Kill the background job"),
  }),
  read: z.object({
    path: z.string().describe("Absolute file path to read"),
  }),
  write: z.object({
    path: z.string().describe("Absolute file path to write"),
    content: z.string().describe("Full file content"),
  }),
  edit: z.object({
    path: z.string().describe("Absolute file path to edit"),
    oldString: z.string().describe("Exact text to replace (must be unique)"),
    newString: z.string().describe("Replacement text"),
  }),
  glob: z.object({
    pattern: z.string().describe("Glob pattern, e.g. src/**/*.ts"),
    cwd: z.string().optional().describe("Directory to search from"),
  }),
  grep: z.object({
    pattern: z.string().describe("Regex to search for"),
    path: z.string().optional().describe("File or directory to search"),
    glob: z.string().optional().describe("Filter files by glob"),
  }),
  skill: z.object({
    name: z
      .string()
      .optional()
      .describe("Skill to load; omit to list available skills"),
  }),
} as const;

export type HostedToolName = keyof typeof hostedToolSchemas;

export const hostedToolDescriptions: Record<HostedToolName, string> = {
  bash: "Run a shell command in the sandbox workspace. Each call is a fresh shell; the working directory persists between calls, exported variables do not.",
  bash_tail:
    "Read new output from (or kill) a background bash job started with runInBackground.",
  read: "Read a file from the sandbox filesystem.",
  write: "Create or overwrite a file in the sandbox filesystem.",
  edit: "Replace an exact unique string in a file.",
  glob: "Find files matching a glob pattern.",
  grep: "Search file contents with a regex.",
  skill:
    "List installed skills (no arguments) or load one skill's instructions by name. Load a skill whenever its description matches the task at hand.",
};

export function hostedSystemPrompt(opts: {
  agentName: string;
  workDir: string;
}): string {
  return [
    `You are a coding agent running in the "${opts.agentName}" sandbox — an isolated Linux environment with a persistent workspace at ${opts.workDir}.`,
    `Use the provided tools to inspect and modify the workspace and to run commands. Prefer glob/grep/read over shell equivalents.`,
    `Installed skills are available through the skill tool. MCP servers, when configured for this sandbox, are reachable via the \`mcpc\` CLI from bash (\`mcpc --help\`).`,
    `The workspace persists between conversations; the rest of the filesystem may reset.`,
    `Be direct and concise. When a task is done, state what you did.`,
  ].join("\n");
}
