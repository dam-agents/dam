export { composeRuntimeChannel } from "./compose.js";
export type { RuntimeChannelComposition } from "./compose.js";
export type { RuntimeManifest } from "./manifest.js";

// Built-in plugin factories. Re-exported so the composition root can
// register them (or selectively replace them with custom plugins) at
// boot, with their dependencies wired explicitly at the call site.
export { createFilePlugin } from "./drivers/file-plugin.js";
export { createMcpEntryPlugin } from "./drivers/mcp-entry-plugin.js";
export {
  createSkillInstallPlugin,
  type SkillInstallFn,
} from "./drivers/skill-install-plugin.js";
