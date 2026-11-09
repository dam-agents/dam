export interface RuntimeEnvReader {
  current(): Record<string, string>;
  ready(): boolean;
}

export interface LeaseEnvReader extends RuntimeEnvReader {
  providers(): string[];
  forLease(lease: {
    harness: string;
    provider: string | null;
  }): Record<string, string>;
  layerEnvFor?(lease: {
    harness: string;
    provider: string | null;
  }): Record<string, string>;
  connectionEnvFor(harness: string): Record<string, string>;
}

export const mergedSpawnEnv = (
  envReader: RuntimeEnvReader,
): NodeJS.ProcessEnv => ({ ...envReader.current(), ...process.env });

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one ladder every harness process is spawned
 * on. A provider or harness layer's variable wins over the machine's own env,
 * since an image may bake a placeholder key and the Connection's addressed
 * placeholder must reach the process for the credential gateway to name the
 * Connection. The settings the harness's manifest claims from its home
 * Connection (`connectionEnvFor`, Bob's Advanced settings) are the lowest
 * rung, under the agent's own env, so an owner's per-agent override of a
 * Connection setting wins, as it does in the router's profile rewrite.
 */
export const leaseSpawnEnv = (
  envReader: LeaseEnvReader,
  lease: { harness: string; provider: string | null; model: string | null },
): NodeJS.ProcessEnv => ({
  ...envReader.connectionEnvFor(lease.harness),
  ...envReader.forLease(lease),
  ...process.env,
  ...envReader.layerEnvFor?.(lease),
  PLATFORM_HARNESS: lease.harness,
  ...(lease.provider !== null && { PLATFORM_PROVIDER: lease.provider }),
  ...(lease.model !== null && { PLATFORM_MODEL: lease.model }),
});
