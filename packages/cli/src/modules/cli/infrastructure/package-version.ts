declare const __CLI_VERSION__: string | undefined;

const DEV_VERSION = "0.0.0-dev";

export function readPackageVersion(): string {
  return typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : DEV_VERSION;
}
