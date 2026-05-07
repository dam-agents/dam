// tsup `define` substitutes this identifier with a JSON string literal at
// build time. In dev (`tsx`), it stays undefined and we report a clear
// "you're running unbundled" sentinel rather than walking the filesystem
// for the source-tree package.json — the production path is always the
// build-time embed.
declare const __CLI_VERSION__: string | undefined;

const DEV_VERSION = "0.0.0-dev";

export function readPackageVersion(): string {
  return typeof __CLI_VERSION__ === "string" ? __CLI_VERSION__ : DEV_VERSION;
}
