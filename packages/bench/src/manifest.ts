import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SeededSession {
  sessionId: string;
  label: string;
  repetitions: number;
  bytes: number;
  loads: number;
}

export interface Manifest {
  env: string;
  agentId: string;
  namespace: string;
  context?: string;
  workdir: string;
  sessions: SeededSession[];
}

export function loadManifest(file: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Manifest;
  } catch {
    return null;
  }
}

export function saveManifest(file: string, manifest: Manifest): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}
