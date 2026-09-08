import { existsSync, readFileSync } from "node:fs";
import {
  parseShippedSkillManifest,
  type ShippedSkillManifest,
} from "../domain/shipped-manifest.js";

export function loadShippedSkillManifest(
  file: string,
  log: (msg: string) => void,
): ShippedSkillManifest | undefined {
  if (!existsSync(file)) {
    log(`no shipped-skill manifest at ${file}; image skills stay unmanaged`);
    return undefined;
  }
  try {
    const manifest = parseShippedSkillManifest(
      JSON.parse(readFileSync(file, "utf8")),
    );
    if (!manifest) {
      log(`shipped-skill manifest at ${file} failed validation; ignoring it`);
    }
    return manifest;
  } catch {
    log(`shipped-skill manifest at ${file} is not JSON; ignoring it`);
    return undefined;
  }
}
