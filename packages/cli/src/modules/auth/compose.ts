import type { Command } from "commander";
import { defaultAuthPath } from "./infrastructure/auth-path.js";
import { createTomlAuthStore, type AuthStore } from "./infrastructure/auth-store.js";

export interface AuthModuleOptions {
  /** Override for the production auth-state path (resolved via XDG —
   *  `$XDG_STATE_HOME/dam/auth.toml`, default
   *  `~/.local/state/dam/auth.toml`). Used by tests; defaults to the
   *  real path otherwise. */
  authPath?: string;
  /** Env to consult for `XDG_STATE_HOME` when resolving the default path.
   *  Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export interface AuthModule {
  commands: ReadonlyArray<Command>;
  /** Cross-module surface — the package-level compose hands these to
   *  consumers that need them. `TokenProvider` lands in issue 5. */
  services: Record<string, never>;
  /** Internal handle for tests and future verbs that compose against the
   *  same on-disk file. Not part of the public package surface. */
  internals: {
    authStore: AuthStore;
    authPath: string;
  };
}

/**
 * Wires the auth module. Commands array is empty until issue 6 lands
 * `login` / `logout` / `status`. The store is wired now so issues 4 and 5
 * can plug in without further refactor.
 */
export function composeAuthModule(opts: AuthModuleOptions = {}): AuthModule {
  const env = opts.env ?? process.env;
  const authPath = opts.authPath ?? defaultAuthPath(env);
  const authStore = createTomlAuthStore(authPath);

  return {
    commands: [],
    services: {},
    internals: { authStore, authPath },
  };
}
