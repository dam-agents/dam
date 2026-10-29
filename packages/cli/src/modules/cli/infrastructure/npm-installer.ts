import { spawn } from "node:child_process";
import { err, ok, type Result } from "../../../result.js";
import { errorMessage, errnoCode } from "../../shared/error-message.js";
import { CLI_PACKAGE } from "./npm-latest-probe.js";

export type InstallError =
  | { kind: "npm-not-found" }
  | { kind: "npm-failed"; exitCode: number | null; signal: string | null }
  | { kind: "npm-launch-failed"; message: string };

export interface NpmInstaller {
  install(version: string): Promise<Result<void, InstallError>>;
}

export function createNpmInstaller(): NpmInstaller {
  return {
    install(version) {
      return new Promise((resolve) => {
        const child = spawn(
          "npm",
          ["install", "--global", `${CLI_PACKAGE}@${version}`],
          {
            shell: false,
            stdio: "inherit",
          },
        );
        let settled = false;
        const finish = (result: Result<void, InstallError>): void => {
          if (settled) return;
          settled = true;
          resolve(result);
        };
        child.on("error", (error) => {
          finish(
            errnoCode(error) === "ENOENT"
              ? err({ kind: "npm-not-found" })
              : err({
                  kind: "npm-launch-failed",
                  message: errorMessage(error),
                }),
          );
        });
        child.on("close", (exitCode, signal) => {
          finish(
            exitCode === 0
              ? ok(undefined)
              : err({ kind: "npm-failed", exitCode, signal }),
          );
        });
      });
    },
  };
}
