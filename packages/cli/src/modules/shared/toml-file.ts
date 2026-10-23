import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { parse, type TomlTable } from "smol-toml";
import { err, ok, type Result } from "../../result.js";
import { errnoCode, errorMessage } from "./error-message.js";

export interface TomlReadProblem {
  problem: "unreadable" | "invalid";
  message: string;
}

export function describeTomlReadProblem(
  filePath: string,
  problem: TomlReadProblem,
): string {
  return problem.problem === "unreadable"
    ? `cannot read ${filePath}: ${problem.message}`
    : `invalid TOML in ${filePath}: ${problem.message}`;
}

export async function readTomlTable(
  filePath: string,
): Promise<Result<TomlTable, TomlReadProblem>> {
  let contents: string;
  try {
    contents = await readFile(filePath, "utf-8");
  } catch (e) {
    if (errnoCode(e) === "ENOENT") return ok({});
    return err({ problem: "unreadable", message: errorMessage(e) });
  }
  try {
    return ok(parse(contents));
  } catch (e) {
    return err({ problem: "invalid", message: errorMessage(e) });
  }
}

export async function writeTomlContents(
  filePath: string,
  contents: string,
  mode?: number,
): Promise<Result<void, string>> {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(tmp, contents, { encoding: "utf-8", mode });
    if (mode !== undefined) await chmod(tmp, mode);
    await rename(tmp, filePath);
    return ok(undefined);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    return err(errorMessage(e));
  }
}
