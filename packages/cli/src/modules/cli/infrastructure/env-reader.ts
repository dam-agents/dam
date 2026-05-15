export interface EnvReader {
  get(name: string): string | undefined;
}

export function createProcessEnvReader(): EnvReader {
  return {
    get: (name) => {
      const v = process.env[name];
      return v && v.length > 0 ? v : undefined;
    },
  };
}
