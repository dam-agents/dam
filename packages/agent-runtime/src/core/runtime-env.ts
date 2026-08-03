// Read-side port for the agent's materialized runtime environment. Produced by
// the env driver (its sole writer); consumed by every process the runtime
// spawns — harness, ssh, terminal, git. Consumers depend on this interface, not
// on how the env is stored; the env-state-store adapter (runtime-channel
// infrastructure) backs it.
export interface RuntimeEnvReader {
  /** Current env (placeholder values), or {} before the first sync. */
  current(): Record<string, string>;
  /** Whether env has been materialized at least once — the cold-boot gate. */
  ready(): boolean;
}

export const mergedSpawnEnv = (
  envReader: RuntimeEnvReader,
): NodeJS.ProcessEnv => ({ ...envReader.current(), ...process.env });
