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
}

export const mergedSpawnEnv = (
  envReader: RuntimeEnvReader,
): NodeJS.ProcessEnv => ({ ...envReader.current(), ...process.env });

/**
 * UNIT_BOUNDARY_DESCRIPTION: a provider or harness layer's variable wins over
 * the machine's own env, since an image may bake a placeholder key and the
 * Connection's addressed placeholder must reach the process for the
 * credential gateway to name the Connection.
 */
export const leaseSpawnEnv = (
  envReader: LeaseEnvReader,
  lease: { harness: string; provider: string | null; model: string | null },
): NodeJS.ProcessEnv => ({
  ...envReader.forLease(lease),
  ...process.env,
  ...envReader.layerEnvFor?.(lease),
  PLATFORM_HARNESS: lease.harness,
  ...(lease.provider !== null && { PLATFORM_PROVIDER: lease.provider }),
  ...(lease.model !== null && { PLATFORM_MODEL: lease.model }),
});
