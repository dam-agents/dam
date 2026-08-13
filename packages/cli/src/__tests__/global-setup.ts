import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "../..");

export default async function (): Promise<void> {
  await exec("pnpm", ["exec", "tsup"], { cwd: PKG_ROOT });
}
