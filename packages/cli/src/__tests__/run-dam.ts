import { execFile } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { vi } from "vitest";
import { compose } from "../compose.js";

export const BIN_PATH = join(
  resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  "dist",
  "js",
  "bin.js",
);

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function spawnDam(
  args: string[],
  env: Record<string, string>,
): Promise<RunResult> {
  try {
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      [BIN_PATH, ...args],
      { env },
    );
    return { exitCode: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
}

const CLI_ENV = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "DAM_TOKEN",
  "DAM_SERVER",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
];

class Exited extends Error {}

export async function runDam(
  args: string[],
  env: Record<string, string>,
): Promise<RunResult> {
  for (const key of CLI_ENV) vi.stubEnv(key, env[key]);
  let exitCode: number | undefined;
  const out = { stdout: "", stderr: "" };
  const capture =
    (stream: keyof typeof out) =>
    (chunk: string | Uint8Array, ...rest: unknown[]): boolean => {
      if (exitCode === undefined) out[stream] += Buffer.from(chunk).toString();
      rest.find((a): a is () => void => typeof a === "function")?.();
      return true;
    };
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation(capture("stdout")),
    vi.spyOn(process.stderr, "write").mockImplementation(capture("stderr")),
    vi.spyOn(process, "exit").mockImplementation((code) => {
      exitCode ??= Number(code ?? 0);
      throw new Exited();
    }),
  ];
  try {
    await compose().parseAsync(["node", "dam", ...args]);
  } catch (e) {
    if (!(e instanceof Exited) && exitCode === undefined) {
      exitCode = 1;
      out.stderr += `${String(e)}\n`;
    }
  } finally {
    for (const spy of spies) spy.mockRestore();
    vi.unstubAllEnvs();
  }
  return { exitCode: exitCode ?? 0, ...out };
}
