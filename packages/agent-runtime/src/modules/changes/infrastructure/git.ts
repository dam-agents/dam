import { runOnce } from "../../../core/run-once.js";
import { err, ok, type Result } from "agent-runtime-api";

const GIT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

export type GitFailure =
  { kind: "capped" } | { kind: "failed"; message: string };

export interface GitOptions {
  maxOutputBytes?: number;
  okExitCodes?: readonly number[];
}

export type Git = (
  cwd: string,
  args: readonly string[],
  opts?: GitOptions,
) => Promise<Result<string, GitFailure>>;

const GIT_ENV = {
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

const READ_ONLY_CONFIG = [
  "-c",
  "core.quotePath=false",
  "-c",
  "color.ui=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.external=",
];

export const runGit: Git = async (cwd, args, opts = {}) => {
  const result = await runOnce({
    command: ["git", ...READ_ONLY_CONFIG, "-C", cwd, ...args],
    timeoutMs: GIT_TIMEOUT_MS,
    env: { ...process.env, ...GIT_ENV },
    maxOutputBytes: opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
  });
  if (result.ok) return ok(result.value.stdout);
  const failure = result.error;
  if (failure.kind === "output-capped") return err({ kind: "capped" });
  if (
    failure.kind === "exited" &&
    failure.code !== null &&
    opts.okExitCodes?.includes(failure.code)
  )
    return ok(failure.stdout);
  const message =
    failure.kind === "exited"
      ? failure.stderr.trim() || `git exited ${failure.code}`
      : failure.kind;
  return err({ kind: "failed", message });
};
