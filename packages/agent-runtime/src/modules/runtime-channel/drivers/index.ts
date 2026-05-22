import { fileDriver } from "./file-driver.js";
import { mcpEntryDriver } from "./mcp-entry-driver.js";
import { skillRefDriver } from "./skill-ref-driver.js";
import { createDriverRegistry, type DriverRegistry } from "./types.js";

/** The built-in driver set every agent image carries. Custom agent
 *  builds extend it via the runtime manifest (`manifest.ts`); manifest
 *  drivers must declare a kind not present here (no override). */
export function createBuiltinDriverRegistry(): DriverRegistry {
  return createDriverRegistry({
    drivers: [fileDriver, mcpEntryDriver, skillRefDriver],
    signalDrivers: [],
  });
}

export type {
  Driver,
  DriverContext,
  DriverRegistry,
  SignalDriver,
} from "./types.js";
export { createDriverRegistry } from "./types.js";
